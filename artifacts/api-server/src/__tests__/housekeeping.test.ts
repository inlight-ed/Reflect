/**
 * Needs a database (DATABASE_URL); skipped otherwise. CI runs it against PostgreSQL.
 * Covers the daily maintenance job and the "3 sign-in attempts per email" limit.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq, like } from "drizzle-orm";
import { AuthError, LOGIN_MAX_ATTEMPTS, login, register } from "../lib/auth";
import { database } from "../lib/database";
import { runMaintenance } from "../lib/maintenance";

const skip = process.env["DATABASE_URL"] ? false : "set DATABASE_URL to run database tests";
const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const emails: string[] = [];
const newEmail = (label: string) => {
  const email = `${label}-${stamp}@example.kz`;
  emails.push(email);
  return email;
};
const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return "OK";
  } catch (error) {
    return error instanceof AuthError ? error.code : String(error);
  }
};

describe("login attempt limit", { skip }, () => {
  after(async () => {
    const { db, usersTable, rateLimitsTable } = await database();
    for (const email of emails) await db.delete(usersTable).where(eq(usersTable.email, email));
    await db.delete(rateLimitsTable).where(like(rateLimitsTable.key, "login:%"));
  });

  it("allows 3 wrong attempts, then blocks the 4th even with the right password", async () => {
    const email = newEmail("limit");
    await register(email, "correct-password");
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) assert.equal(await code(login(email, "wrong-password")), "INVALID_CREDENTIALS");
    assert.equal(await code(login(email, "correct-password")), "TOO_MANY_ATTEMPTS");
    // Another address is not affected.
    const other = newEmail("other");
    await register(other, "correct-password");
    assert.equal(await code(login(other, "correct-password")), "OK");
  });

  it("a successful sign-in starts the count again", async () => {
    const email = newEmail("reset");
    await register(email, "correct-password");
    assert.equal(await code(login(email, "bad")), "INVALID_CREDENTIALS");
    assert.equal(await code(login(email, "bad")), "INVALID_CREDENTIALS");
    assert.equal(await code(login(email, "correct-password")), "OK");
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) assert.equal(await code(login(email, "bad")), "INVALID_CREDENTIALS");
    assert.equal(await code(login(email, "bad")), "TOO_MANY_ATTEMPTS");
  });

  it("counts addresses that have no account too, so the limit does not reveal who has one", async () => {
    const email = newEmail("ghost");
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) assert.equal(await code(login(email, "bad")), "INVALID_CREDENTIALS");
    assert.equal(await code(login(email, "bad")), "TOO_MANY_ATTEMPTS");
  });

  it("is not case sensitive", async () => {
    const email = newEmail("case");
    await register(email, "correct-password");
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) await code(login(email.toUpperCase(), "bad"));
    assert.equal(await code(login(email, "correct-password")), "TOO_MANY_ATTEMPTS");
  });
});

describe("daily maintenance", { skip }, () => {
  const userId = randomUUID();
  after(async () => {
    const { db, usersTable } = await database();
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  it("removes expired sessions of any user, old sync log and stale counters, and keeps the rest", async () => {
    const { db, usersTable, sessionsTable, syncRunsTable, rateLimitsTable } = await database();
    const day = 86_400_000;
    await db.insert(usersTable).values({ id: userId, email: `maint-${stamp}@example.kz`, passwordHash: "x" });
    await db.insert(sessionsTable).values([
      { id: `${userId}-old`, userId, expiresAt: new Date(Date.now() - day) },
      { id: `${userId}-live`, userId, expiresAt: new Date(Date.now() + day) },
    ]);
    await db.insert(syncRunsTable).values([
      { id: `${userId}-old-done`, userId, kind: "KASPI_API", status: "DONE", startedAt: new Date(Date.now() - 100 * day), finishedAt: new Date(Date.now() - 100 * day) },
      { id: `${userId}-recent-done`, userId, kind: "MOYSKLAD", status: "DONE", startedAt: new Date(Date.now() - day), finishedAt: new Date(Date.now() - day) },
      { id: `${userId}-stuck`, userId, kind: "CUSTOM_MCP", status: "RUNNING", startedAt: new Date(Date.now() - 3 * day) },
    ]);
    await db.insert(rateLimitsTable).values([
      { key: `maint-${stamp}-expired`, count: 1, resetAt: new Date(Date.now() - 3 * day) },
      { key: `maint-${stamp}-active`, count: 1, resetAt: new Date(Date.now() + day) },
    ]);

    const result = await runMaintenance();
    assert.ok(result, "maintenance should run when nobody else holds the lock");
    assert.ok(result.sessions >= 1 && result.syncRuns >= 1 && result.stuckSyncs >= 1 && result.counters >= 1);

    const sessions = (await db.select({ id: sessionsTable.id }).from(sessionsTable).where(eq(sessionsTable.userId, userId))).map((row) => row.id);
    assert.deepEqual(sessions, [`${userId}-live`]);
    const runs = await db.select().from(syncRunsTable).where(eq(syncRunsTable.userId, userId));
    assert.deepEqual(runs.map((row) => row.id).sort(), [`${userId}-recent-done`, `${userId}-stuck`]);
    assert.equal(runs.find((row) => row.id === `${userId}-stuck`)?.status, "FAILED");
    const counters = (await db.select({ key: rateLimitsTable.key }).from(rateLimitsTable).where(like(rateLimitsTable.key, `maint-${stamp}-%`))).map((row) => row.key);
    assert.deepEqual(counters, [`maint-${stamp}-active`]);

    // Running it again changes nothing for these rows.
    await runMaintenance();
    assert.deepEqual((await db.select({ id: sessionsTable.id }).from(sessionsTable).where(eq(sessionsTable.userId, userId))).map((row) => row.id), [`${userId}-live`]);
    assert.equal((await db.select().from(syncRunsTable).where(eq(syncRunsTable.userId, userId))).length, 2);
  });
});
