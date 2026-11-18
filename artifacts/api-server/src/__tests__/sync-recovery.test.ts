/**
 * Needs a database (DATABASE_URL); skipped otherwise. CI runs it against PostgreSQL.
 * A sync whose instance died (heartbeat stopped) starts again by itself; a live one is left alone.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { register } from "../lib/auth";
import { database } from "../lib/database";
import { resumeInterruptedSyncs } from "../lib/integrations/service";
import { saveIntegration } from "../lib/integrations/store";
import { deleteAccountForTests } from "./helpers";

const skip = process.env["DATABASE_URL"] ? false : "set DATABASE_URL to run database tests";
const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
let server: Server;

describe("sync recovery after a restart", { skip }, () => {
  const ids: string[] = [];
  before(async () => {
    // Kaspi stand-in that answers an empty order list, so a resumed sync finishes quickly.
    server = createServer((_req, res) => { res.setHeader("content-type", "application/vnd.api+json"); res.end(JSON.stringify({ data: [], meta: { pageCount: 0, totalCount: 0 } })); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    process.env["KASPI_API_BASE"] = `http://127.0.0.1:${(server.address() as AddressInfo).port}/shop/api/v2`;
  });
  after(async () => {
    for (const id of ids) await deleteAccountForTests(id);
    delete process.env["KASPI_API_BASE"];
    server.close();
  });

  async function sellerWithRun(heartbeatAgoMs: number) {
    const { user, workspaceId } = await register(`recovery-${ids.length}-${stamp}@example.kz`, "password-123");
    ids.push(user.id);
    await saveIntegration(workspaceId, "KASPI_API", { secret: `token-${stamp}`, status: "SYNCING" });
    const { db, syncRunsTable } = await database();
    const runId = randomUUID();
    await db.insert(syncRunsTable).values({ id: runId, workspaceId, kind: "KASPI_API", status: "RUNNING", heartbeatAt: new Date(Date.now() - heartbeatAgoMs) });
    return { workspaceId, runId };
  }

  it("resumes a run whose heartbeat stopped and leaves a live run alone", async () => {
    const dead = await sellerWithRun(10 * 60_000);
    const live = await sellerWithRun(10_000);
    const result = await resumeInterruptedSyncs();
    assert.ok(result.resumed >= 1);

    const { db, syncRunsTable } = await database();
    const [old] = await db.select().from(syncRunsTable).where(eq(syncRunsTable.id, dead.runId));
    assert.equal(old?.status, "FAILED");
    assert.equal(old?.detail, "connector.sync.interrupted");
    const restarted = await db.select().from(syncRunsTable).where(and(eq(syncRunsTable.workspaceId, dead.workspaceId), eq(syncRunsTable.kind, "KASPI_API")));
    assert.equal(restarted.length, 2, "a new run was started for the interrupted seller");

    const [untouched] = await db.select().from(syncRunsTable).where(eq(syncRunsTable.id, live.runId));
    assert.equal(untouched?.status, "RUNNING");
  });
});
