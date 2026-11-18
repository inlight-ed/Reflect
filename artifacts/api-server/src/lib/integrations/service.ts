import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { SourceMessageKey } from "@workspace/api-zod";
import { limitConcurrency } from "../concurrency";
import { database } from "../database";
import { logger, safeError } from "../logger";
import { importOrders, importProducts } from "../user-data";
import { fetchKaspiOrders, KaspiError, testKaspiToken } from "./kaspi";
import { listMcpTools, McpError } from "./mcp";
import { fetchMoyskladStock, MoyskladError, testMoyskladToken } from "./moysklad";
import { deleteIntegration, getIntegration, listIntegrations, saveIntegration, updateIntegrationStatus, type IntegrationKind } from "./store";

export const CONNECTION_KINDS: IntegrationKind[] = ["KASPI_API", "MOYSKLAD", "REDSTAT_MCP", "CUSTOM_MCP"];

export class ConnectionInputError extends Error {}

type ConnectionView = {
  kind: IntegrationKind;
  url: string | null;
  secretHint: string | null;
  status: "CONNECTED" | "ERROR" | "SYNCING" | "NOT_CONNECTED";
  detail?: SourceMessageKey;
  lastSyncAt: string | null;
  imported?: number;
  tools?: Array<{ name: string; description: string }>;
};

function errorDetail(kind: IntegrationKind, error: unknown): SourceMessageKey {
  if (error instanceof KaspiError) return error.code === "UNAUTHORIZED" ? "connector.kaspi.invalid_token" : "connector.kaspi.unavailable";
  if (error instanceof MoyskladError) return error.code === "UNAUTHORIZED" ? "connector.moysklad.invalid_token" : "connector.moysklad.unavailable";
  if (error instanceof McpError) return error.code === "UNSAFE_URL" ? "connector.mcp.unsafe_url" : error.code === "UNAUTHORIZED" ? "connector.mcp.unauthorized" : "connector.mcp.unavailable";
  return kind === "KASPI_API" ? "connector.kaspi.unavailable" : kind === "MOYSKLAD" ? "connector.moysklad.unavailable" : "connector.mcp.unavailable";
}

const okDetail: Record<IntegrationKind, SourceMessageKey> = {
  KASPI_API: "connector.kaspi.connected",
  MOYSKLAD: "connector.moysklad.connected",
  REDSTAT_MCP: "connector.mcp.connected",
  CUSTOM_MCP: "connector.mcp.connected",
};

export async function connectionViews(workspaceId: string): Promise<ConnectionView[]> {
  const stored = await listIntegrations(workspaceId);
  return CONNECTION_KINDS.map((kind) => {
    const row = stored.find((item) => item.kind === kind);
    if (!row) return { kind, url: null, secretHint: null, status: "NOT_CONNECTED", detail: "connector.not_connected", lastSyncAt: null };
    const meta = row.meta ?? {};
    // A sync that never finished (instance restarted mid-run) must not look busy forever.
    const stuck = row.status === "SYNCING" && Date.now() - row.updatedAt.getTime() > STALE_SYNC_MS;
    return {
      kind,
      url: row.url,
      secretHint: row.secretHint,
      status: !row.secretReadable || stuck ? "ERROR" : row.status,
      detail: (!row.secretReadable ? "connector.encryption.reset" : stuck ? "connector.sync.interrupted" : row.detail) as SourceMessageKey,
      lastSyncAt: row.lastSyncAt,
      ...(typeof meta.imported === "number" ? { imported: meta.imported } : {}),
      ...(Array.isArray(meta.tools) ? { tools: meta.tools as ConnectionView["tools"] } : {}),
    };
  });
}

async function view(workspaceId: string, kind: IntegrationKind) {
  return (await connectionViews(workspaceId)).find((item) => item.kind === kind)!;
}

export async function saveConnection(workspaceId: string, kind: IntegrationKind, input: { url?: string; secret?: string }) {
  const previous = await getIntegration(workspaceId, kind);
  const secret = input.secret?.trim() || previous?.secret || null;
  const url = kind === "REDSTAT_MCP" || kind === "CUSTOM_MCP" ? input.url?.trim() || previous?.url || null : null;
  if ((kind === "KASPI_API" || kind === "MOYSKLAD") && !secret) throw new ConnectionInputError("SECRET_REQUIRED");
  if ((kind === "REDSTAT_MCP" || kind === "CUSTOM_MCP") && !url) throw new ConnectionInputError("URL_REQUIRED");

  let tools: Array<{ name: string; description: string }> | undefined;
  try {
    if (kind === "KASPI_API") await testKaspiToken(secret!);
    else if (kind === "MOYSKLAD") await testMoyskladToken(secret!);
    else tools = await listMcpTools(url!, secret);
    await saveIntegration(workspaceId, kind, { url, secret, status: "CONNECTED", detail: okDetail[kind], meta: tools ? { tools: tools.slice(0, 50) } : null, lastSyncAt: previous?.lastSyncAt ?? null });
  } catch (error) {
    await saveIntegration(workspaceId, kind, { url, secret, status: "ERROR", detail: errorDetail(kind, error), meta: null });
  }
  return view(workspaceId, kind);
}

export async function removeConnection(workspaceId: string, kind: IntegrationKind) {
  await deleteIntegration(workspaceId, kind);
}

const STALE_SYNC_MS = 15 * 60_000;
/** A run whose owner stopped refreshing its heartbeat for this long is treated as dead. */
const HEARTBEAT_TIMEOUT_MS = 5 * 60_000;
const HEARTBEAT_EVERY_MS = 60_000;
/** Runs this instance owns, queued or running: their heartbeat is refreshed while it is alive. */
const ownRuns = new Set<string>();
/**
 * Syncs running at once on this instance (SYNC_CONCURRENCY, default 4). Each seller already has at
 * most one sync per source; this caps the total, so 50 sellers pressing "Sync" together do not
 * send 50 crawls to Kaspi and MoySklad at the same moment. The rest wait their turn.
 */
export const syncSlots = limitConcurrency(Math.max(1, Number(process.env["SYNC_CONCURRENCY"]) || 4));
/**
 * Kaspi orders change status for up to 3 days after they are created, and the API cannot filter
 * by change date, so each sync re-reads the last 3 days before the previous complete sync, plus a
 * day of margin.
 */
export const KASPI_OVERLAP_DAYS = 4;
const RETRY_DELAYS_MS = [2_000, 6_000];

const transient = (error: unknown) =>
  (error instanceof KaspiError || error instanceof MoyskladError || error instanceof McpError) ? error.code === "UNAVAILABLE" : !(error instanceof Error && /PRIVATE_ADDRESS|HTTPS_REQUIRED/.test(error.message));

/** Retries a source call on timeouts and 5xx; wrong tokens and bad responses fail at once. */
async function withRetries<T>(task: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length || !transient(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
}

/**
 * Starts a sync in the background and returns at once with status SYNCING; the client polls
 * the connection until it changes. A RUNNING row in sync_runs is the lock: its partial unique
 * index allows one running sync per workspace and source across all API instances, so a second
 * click (or a second instance) joins the running sync instead of starting another.
 */
export async function startSync(workspaceId: string, kind: IntegrationKind) {
  const stored = await getIntegration(workspaceId, kind);
  if (!stored || (!stored.secret && kind !== "CUSTOM_MCP" && kind !== "REDSTAT_MCP")) return view(workspaceId, kind);
  const { db, syncRunsTable } = await database();
  // Free locks left by a run that died with its instance.
  await db.update(syncRunsTable).set({ status: "FAILED", detail: "connector.sync.interrupted", finishedAt: new Date() })
    .where(and(eq(syncRunsTable.workspaceId, workspaceId), eq(syncRunsTable.kind, kind), eq(syncRunsTable.status, "RUNNING"), lt(syncRunsTable.heartbeatAt, new Date(Date.now() - HEARTBEAT_TIMEOUT_MS))));
  const runId = randomUUID();
  const inserted = await db.insert(syncRunsTable).values({ id: runId, workspaceId, kind, status: "RUNNING" }).onConflictDoNothing().returning({ id: syncRunsTable.id });
  if (!inserted.length) return { ...(await view(workspaceId, kind)), status: "SYNCING" as const };
  await updateIntegrationStatus(workspaceId, kind, "SYNCING", null);
  ownRuns.add(runId);
  // Queued behind other sellers' syncs; the run counts as started when it gets a slot, so a long
  // wait in the queue is not mistaken for a run that died.
  void syncSlots.run(
    () => runSync(workspaceId, kind, runId, stored),
    async () => { await db.update(syncRunsTable).set({ startedAt: new Date(), heartbeatAt: new Date() }).where(eq(syncRunsTable.id, runId)); },
  ).catch((err) => logger.error({ err: safeError(err), kind }, "Sync crashed"))
    .finally(() => ownRuns.delete(runId));
  return { ...(await view(workspaceId, kind)), status: "SYNCING" as const };
}

async function runSync(workspaceId: string, kind: IntegrationKind, runId: string, stored: NonNullable<Awaited<ReturnType<typeof getIntegration>>>) {
  const { db, syncRunsTable } = await database();
  const started = Date.now();
  let rows: number | null = null;
  let detail: SourceMessageKey;
  let ok = true;
  try {
    if (kind === "KASPI_API") {
      // completeThrough = the start of the last sync that read everything. Later syncs begin a few
      // days before it. A truncated sync does not move it, so what it missed is read again.
      const previous = typeof stored.meta?.completeThrough === "string" ? new Date(stored.meta.completeThrough) : undefined;
      const since = previous && !Number.isNaN(previous.getTime()) ? new Date(previous.getTime() - KASPI_OVERLAP_DAYS * 86_400_000) : undefined;
      const { lines, truncated } = await fetchKaspiOrders(stored.secret!, 60, since);
      const result = lines.length ? await importOrders(workspaceId, lines, "KASPI_API", null) : { accepted: 0 };
      rows = result.accepted;
      detail = truncated ? "connector.sync.truncated" : "connector.sync.done";
      const completeThrough = truncated ? previous?.toISOString() : new Date(started).toISOString();
      await updateIntegrationStatus(workspaceId, kind, "CONNECTED", detail, { meta: { imported: result.accepted, ...(completeThrough ? { completeThrough } : {}) }, lastSyncAt: new Date() });
    } else if (kind === "MOYSKLAD") {
      const products = await withRetries(() => fetchMoyskladStock(stored.secret!));
      const result = products.length ? await importProducts(workspaceId, products, "MOYSKLAD", null) : { accepted: 0 };
      rows = result.accepted;
      detail = "connector.sync.done";
      await updateIntegrationStatus(workspaceId, kind, "CONNECTED", detail, { meta: { imported: result.accepted }, lastSyncAt: new Date() });
    } else {
      const tools = await withRetries(() => listMcpTools(stored.url!, stored.secret));
      detail = okDetail[kind];
      await updateIntegrationStatus(workspaceId, kind, "CONNECTED", detail, { meta: { tools: tools.slice(0, 50) }, lastSyncAt: new Date() });
    }
  } catch (error) {
    ok = false;
    detail = errorDetail(kind, error);
    await updateIntegrationStatus(workspaceId, kind, "ERROR", detail);
  }
  await db.update(syncRunsTable).set({ status: ok ? "DONE" : "FAILED", detail, rows, finishedAt: new Date() }).where(eq(syncRunsTable.id, runId));
  logger.info({ kind, ok, rows, ms: Date.now() - started }, "Sync finished");
}

/** Waits for a background sync to finish (tests and scripts). */
export async function syncConnection(workspaceId: string, kind: IntegrationKind, timeoutMs = 120_000) {
  await startSync(workspaceId, kind);
  const { db, syncRunsTable } = await database();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [running] = await db.select({ id: syncRunsTable.id }).from(syncRunsTable).where(and(eq(syncRunsTable.workspaceId, workspaceId), eq(syncRunsTable.kind, kind), eq(syncRunsTable.status, "RUNNING"))).limit(1);
    if (!running) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return view(workspaceId, kind);
}

/** Last sync runs for the settings page log. */
export async function recentSyncRuns(workspaceId: string, limit = 10) {
  const { db, syncRunsTable } = await database();
  const rows = await db.select().from(syncRunsTable).where(eq(syncRunsTable.workspaceId, workspaceId)).orderBy(sql`${syncRunsTable.startedAt} desc`).limit(limit);
  return rows.map((row) => ({ id: row.id, kind: row.kind as IntegrationKind, status: row.status as "RUNNING" | "DONE" | "FAILED", detail: (row.detail ?? undefined) as SourceMessageKey | undefined, rows: row.rows, startedAt: row.startedAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null }));
}


/**
 * Picks up syncs whose instance died or was redeployed mid-run: their lock is released and the
 * sync starts again from the last complete point (Kaspi re-reads a few days of overlap, imports
 * are upserts), so a restart costs a little time, never data. Runs on startup and every few minutes.
 */
export async function resumeInterruptedSyncs(limit = 50) {
  const { db, syncRunsTable } = await database();
  const dead = await db.update(syncRunsTable).set({ status: "FAILED", detail: "connector.sync.interrupted", finishedAt: new Date() })
    .where(and(eq(syncRunsTable.status, "RUNNING"), lt(syncRunsTable.heartbeatAt, new Date(Date.now() - HEARTBEAT_TIMEOUT_MS))))
    .returning({ workspaceId: syncRunsTable.workspaceId, kind: syncRunsTable.kind });
  let resumed = 0;
  for (const run of dead.slice(0, limit)) {
    try {
      const view = await startSync(run.workspaceId, run.kind as IntegrationKind);
      if (view.status === "SYNCING") resumed += 1;
    } catch (err) {
      logger.warn({ err: safeError(err), kind: run.kind }, "Could not resume a sync");
    }
  }
  if (dead.length) logger.info({ interrupted: dead.length, resumed }, "Resumed interrupted syncs");
  return { interrupted: dead.length, resumed };
}

/** Keeps this instance's runs alive in the database and resumes runs of instances that died. */
export function scheduleSyncRecovery() {
  const beat = async () => {
    if (!ownRuns.size) return;
    const { db, syncRunsTable } = await database();
    await db.update(syncRunsTable).set({ heartbeatAt: new Date() })
      .where(and(eq(syncRunsTable.status, "RUNNING"), inArray(syncRunsTable.id, [...ownRuns])));
  };
  const sweep = () => resumeInterruptedSyncs().catch((err) => logger.warn({ err: safeError(err) }, "Sync recovery failed"));
  setInterval(() => void beat().catch((err) => logger.warn({ err: safeError(err) }, "Sync heartbeat failed")), HEARTBEAT_EVERY_MS).unref();
  setTimeout(() => void sweep(), 30_000).unref();
  setInterval(() => void sweep(), HEARTBEAT_TIMEOUT_MS).unref();
}

/**
 * On a planned stop (redeploy, docker stop) hands this instance's runs over at once: their
 * heartbeat is cleared, so the next instance resumes them on startup instead of in 5 minutes.
 */
export async function releaseOwnSyncs() {
  if (!ownRuns.size) return;
  const { db, syncRunsTable } = await database();
  await db.update(syncRunsTable).set({ heartbeatAt: new Date(0) })
    .where(and(eq(syncRunsTable.status, "RUNNING"), inArray(syncRunsTable.id, [...ownRuns])));
}
