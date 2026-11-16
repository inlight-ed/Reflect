/**
 * Needs a database (DATABASE_URL); skipped otherwise. CI runs it against PostgreSQL.
 * Links are created the way deploy/reset-password.sh creates them: sha256 of the token in the table.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { and, eq, gt } from "drizzle-orm";
import { AuthError, LOGIN_MAX_ATTEMPTS, login, register } from "../lib/auth";
import { database } from "../lib/database";
import { requestPasswordReset, resetPassword } from "../lib/password-reset";
import { newToken, sha256 } from "../lib/security";

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

async function issueLink(userId: string, expiresInMs = 60 * 60_000) {
  const { db, passwordResetsTable } = await database();
  const token = newToken();
  await db.insert(passwordResetsTable).values({ tokenHash: sha256(token), userId, expiresAt: new Date(Date.now() + expiresInMs) });
  return token;
}

describe("password reset", { skip }, () => {
  after(async () => {
    const { db, usersTable } = await database();
    for (const email of emails) await db.delete(usersTable).where(eq(usersTable.email, email));
  });

  it("sets the new password, ends every session, and the link works only once", async () => {
    const email = newEmail("reset");
    const { user } = await register(email, "old-password-1");
    await login(email, "old-password-1");
    const token = await issueLink(user.id);

    const changed = await resetPassword(token, "new-password-2");
    assert.equal(changed.email, email);
    const { db, sessionsTable } = await database();
    const sessions = await db.select().from(sessionsTable).where(and(eq(sessionsTable.userId, user.id), gt(sessionsTable.expiresAt, new Date())));
    assert.equal(sessions.length, 0, "old sessions are ended");
    assert.equal(await code(login(email, "old-password-1")), "INVALID_CREDENTIALS");
    assert.equal(await code(login(email, "new-password-2")), "OK");
    assert.equal(await code(resetPassword(token, "another-password-3")), "INVALID_RESET_LINK");
  });

  it("refuses expired and unknown links and weak passwords", async () => {
    const { user } = await register(newEmail("expired"), "old-password-1");
    assert.equal(await code(resetPassword(await issueLink(user.id, -1000), "new-password-2")), "INVALID_RESET_LINK");
    assert.equal(await code(resetPassword(newToken(), "new-password-2")), "INVALID_RESET_LINK");
    assert.equal(await code(resetPassword(await issueLink(user.id), "short")), "WEAK_PASSWORD");
  });

  it("lifts the sign-in block of the address", async () => {
    const email = newEmail("blocked");
    const { user } = await register(email, "old-password-1");
    for (let i = 0; i <= LOGIN_MAX_ATTEMPTS; i += 1) await code(login(email, "wrong"));
    assert.equal(await code(login(email, "old-password-1")), "TOO_MANY_ATTEMPTS");
    await resetPassword(await issueLink(user.id), "new-password-2");
    assert.equal(await code(login(email, "new-password-2")), "OK");
  });

  it("answers requests the same way for unknown addresses and stores nothing without mail", async () => {
    delete process.env["SMTP_URL"];
    const email = newEmail("request");
    const { user } = await register(email, "old-password-1");
    assert.equal(await code(requestPasswordReset(email)), "OK");
    assert.equal(await code(requestPasswordReset(`nobody-${stamp}@example.kz`)), "OK");
    const { db, passwordResetsTable } = await database();
    const links = await db.select().from(passwordResetsTable).where(eq(passwordResetsTable.userId, user.id));
    assert.equal(links.length, 0, "no email is configured, so no link is created");
  });
});
