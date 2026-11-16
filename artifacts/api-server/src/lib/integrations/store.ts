import { and, eq } from "drizzle-orm";
import { database } from "../database";
import { decryptSecret, encryptSecret, openSecret, secretHint } from "../security";

export type IntegrationKind = "KASPI_API" | "MOYSKLAD" | "REDSTAT_MCP" | "CUSTOM_MCP";
export type IntegrationState = "CONNECTED" | "ERROR" | "SYNCING" | "NOT_CONNECTED";

export type StoredIntegration = {
  kind: IntegrationKind;
  url: string | null;
  secret: string | null;
  status: IntegrationState;
  detail: string | null;
  meta: Record<string, unknown> | null;
  lastSyncAt: Date | null;
};

export async function getIntegration(userId: string, kind: IntegrationKind): Promise<StoredIntegration | undefined> {
  const { db, integrationsTable } = await database();
  const [row] = await db.select().from(integrationsTable).where(and(eq(integrationsTable.userId, userId), eq(integrationsTable.kind, kind))).limit(1);
  if (!row) return undefined;
  const opened = row.secret ? openSecret(row.secret) : undefined;
  if (opened?.rotated) {
    // Encrypted with a previous key: re-encrypt with the current one.
    await db.update(integrationsTable).set({ secret: encryptSecret(opened.plain) }).where(and(eq(integrationsTable.userId, userId), eq(integrationsTable.kind, kind)));
  }
  return {
    kind,
    url: row.url,
    secret: opened?.plain ?? null,
    status: row.status as IntegrationState,
    detail: row.detail,
    meta: (row.meta as Record<string, unknown> | null) ?? null,
    lastSyncAt: row.lastSyncAt,
  };
}

export async function saveIntegration(userId: string, kind: IntegrationKind, values: { url?: string | null; secret?: string | null; status: IntegrationState; detail?: string | null; meta?: Record<string, unknown> | null; lastSyncAt?: Date | null }) {
  const { db, integrationsTable } = await database();
  const row = {
    userId,
    kind,
    url: values.url ?? null,
    secret: values.secret ? encryptSecret(values.secret) : null,
    status: values.status,
    detail: values.detail ?? null,
    meta: values.meta ?? null,
    lastSyncAt: values.lastSyncAt ?? null,
    updatedAt: new Date(),
  };
  await db.insert(integrationsTable).values(row).onConflictDoUpdate({ target: [integrationsTable.userId, integrationsTable.kind], set: row });
}

export async function updateIntegrationStatus(userId: string, kind: IntegrationKind, status: IntegrationState, detail: string | null, extra: { meta?: Record<string, unknown>; lastSyncAt?: Date } = {}) {
  const { db, integrationsTable } = await database();
  await db.update(integrationsTable).set({ status, detail, updatedAt: new Date(), ...(extra.meta ? { meta: extra.meta } : {}), ...(extra.lastSyncAt ? { lastSyncAt: extra.lastSyncAt } : {}) })
    .where(and(eq(integrationsTable.userId, userId), eq(integrationsTable.kind, kind)));
}

export async function deleteIntegration(userId: string, kind: IntegrationKind) {
  const { db, integrationsTable } = await database();
  await db.delete(integrationsTable).where(and(eq(integrationsTable.userId, userId), eq(integrationsTable.kind, kind)));
}

/** Public view: never includes the secret, only a short hint. */
export async function listIntegrations(userId: string) {
  const { db, integrationsTable } = await database();
  const rows = await db.select().from(integrationsTable).where(eq(integrationsTable.userId, userId));
  return rows.map((row) => {
    const secret = row.secret ? decryptSecret(row.secret) : undefined;
    return {
      kind: row.kind as IntegrationKind,
      url: row.url,
      secretHint: secret ? secretHint(secret) : row.secret ? "••••" : null,
      secretReadable: row.secret ? Boolean(secret) : true,
      status: row.status as IntegrationState,
      detail: row.detail,
      meta: (row.meta as Record<string, unknown> | null) ?? null,
      lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
      updatedAt: row.updatedAt,
    };
  });
}
