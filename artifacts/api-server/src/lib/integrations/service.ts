import { randomUUID } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import type { SourceMessageKey } from "@workspace/api-zod";
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

export async function connectionViews(userId: string): Promise<ConnectionView[]> {
  const stored = await listIntegrations(userId);
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

async function view(userId: string, kind: IntegrationKind) {
  return (await connectionViews(userId)).find((item) => item.kind === kind)!;
}

export async function saveConnection(userId: string, kind: IntegrationKind, input: { url?: string; secret?: string }) {
  const previous = await getIntegration(userId, kind);
  const secret = input.secret?.trim() || previous?.secret || null;
  const url = kind === "REDSTAT_MCP" || kind === "CUSTOM_MCP" ? input.url?.trim() || previous?.url || null : null;
  if ((kind === "KASPI_API" || kind === "MOYSKLAD") && !secret) throw new ConnectionInputError("SECRET_REQUIRED");
  if ((kind === "REDSTAT_MCP" || kind === "CUSTOM_MCP") && !url) throw new ConnectionInputError("URL_REQUIRED");

  let tools: Array<{ name: string; description: string }> | undefined;
  try {
    if (kind === "KASPI_API") await testKaspiToken(secret!);
    else if (kind === "MOYSKLAD") await testMoyskladToken(secret!);
    else tools = await listMcpTools(url!, secret);
    await saveIntegration(userId, kind, { url, secret, status: "CONNECTED", detail: okDetail[kind], meta: tools ? { tools: tools.slice(0, 50) } : null, lastSyncAt: previous?.lastSyncAt ?? null });
  } catch (error) {
    await saveIntegration(userId, kind, { url, secret, status: "ERROR", detail: errorDetail(kind, error), meta: null });
  }
  return view(userId, kind);
}

export async function removeConnection(userId: string, kind: IntegrationKind) {
  await deleteIntegration(userId, kind);
}

const STALE_SYNC_MS = 15 * 60_000;
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
 * index allows one running sync per user and source across all API instances, so a second
 * click (or a second instance) joins the running sync instead of starting another.
 */
export async function startSync(userId: string, kind: IntegrationKind) {
  const stored = await getIntegration(userId, kind);
  if (!stored || (!stored.secret && kind !== "CUSTOM_MCP" && kind !== "REDSTAT_MCP")) return view(userId, kind);
  const { db, syncRunsTable } = await database();
  // Free locks left by a run that died with its instance.
  await db.update(syncRunsTable).set({ status: "FAILED", detail: "connector.sync.interrupted", finishedAt: new Date() })
    .where(and(eq(syncRunsTable.userId, userId), eq(syncRunsTable.kind, kind), eq(syncRunsTable.status, "RUNNING"), lt(syncRunsTable.startedAt, new Date(Date.now() - STALE_SYNC_MS))));
  const runId = randomUUID();
  const inserted = await db.insert(syncRunsTable).values({ id: runId, userId, kind, status: "RUNNING" }).onConflictDoNothing().returning({ id: syncRunsTable.id });
  if (!inserted.length) return { ...(await view(userId, kind)), status: "SYNCING" as const };
  await updateIntegrationStatus(userId, kind, "SYNCING", null);
  void runSync(userId, kind, runId, stored).catch((err) => logger.error({ err: safeError(err), kind }, "Sync crashed"));
  return { ...(await view(userId, kind)), status: "SYNCING" as const };
}

async function runSync(userId: string, kind: IntegrationKind, runId: string, stored: NonNullable<Awaited<ReturnType<typeof getIntegration>>>) {
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
      const result = lines.length ? await importOrders(userId, lines, "KASPI_API", null) : { accepted: 0 };
      rows = result.accepted;
      detail = truncated ? "connector.sync.truncated" : "connector.sync.done";
      const completeThrough = truncated ? previous?.toISOString() : new Date(started).toISOString();
      await updateIntegrationStatus(userId, kind, "CONNECTED", detail, { meta: { imported: result.accepted, ...(completeThrough ? { completeThrough } : {}) }, lastSyncAt: new Date() });
    } else if (kind === "MOYSKLAD") {
      const products = await withRetries(() => fetchMoyskladStock(stored.secret!));
      const result = products.length ? await importProducts(userId, products, "MOYSKLAD", null) : { accepted: 0 };
      rows = result.accepted;
      detail = "connector.sync.done";
      await updateIntegrationStatus(userId, kind, "CONNECTED", detail, { meta: { imported: result.accepted }, lastSyncAt: new Date() });
    } else {
      const tools = await withRetries(() => listMcpTools(stored.url!, stored.secret));
      detail = okDetail[kind];
      await updateIntegrationStatus(userId, kind, "CONNECTED", detail, { meta: { tools: tools.slice(0, 50) }, lastSyncAt: new Date() });
    }
  } catch (error) {
    ok = false;
    detail = errorDetail(kind, error);
    await updateIntegrationStatus(userId, kind, "ERROR", detail);
  }
  await db.update(syncRunsTable).set({ status: ok ? "DONE" : "FAILED", detail, rows, finishedAt: new Date() }).where(eq(syncRunsTable.id, runId));
  logger.info({ kind, ok, rows, ms: Date.now() - started }, "Sync finished");
}

/** Waits for a background sync to finish (tests and scripts). */
export async function syncConnection(userId: string, kind: IntegrationKind, timeoutMs = 120_000) {
  await startSync(userId, kind);
  const { db, syncRunsTable } = await database();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [running] = await db.select({ id: syncRunsTable.id }).from(syncRunsTable).where(and(eq(syncRunsTable.userId, userId), eq(syncRunsTable.kind, kind), eq(syncRunsTable.status, "RUNNING"))).limit(1);
    if (!running) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return view(userId, kind);
}

/** Last sync runs for the settings page log. */
export async function recentSyncRuns(userId: string, limit = 10) {
  const { db, syncRunsTable } = await database();
  const rows = await db.select().from(syncRunsTable).where(eq(syncRunsTable.userId, userId)).orderBy(sql`${syncRunsTable.startedAt} desc`).limit(limit);
  return rows.map((row) => ({ id: row.id, kind: row.kind as IntegrationKind, status: row.status as "RUNNING" | "DONE" | "FAILED", detail: (row.detail ?? undefined) as SourceMessageKey | undefined, rows: row.rows, startedAt: row.startedAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null }));
}
