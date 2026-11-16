import { and, eq, gt, lt } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { database, hasDatabase } from "./database";
import { hashPassword, newToken, sha256, timingDummyHash, verifyPassword } from "./security";

export type SessionUser = { id: string; email: string; name: string | null };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export const SESSION_COOKIE = "reflect_session";
const SESSION_DAYS = 30;

export class AuthError extends Error {
  constructor(public code: "EMAIL_TAKEN" | "INVALID_CREDENTIALS" | "WEAK_PASSWORD" | "INVALID_EMAIL" | "ACCOUNTS_UNAVAILABLE") {
    super(code);
  }
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateCredentials(email: string, password: string) {
  if (!EMAIL_RE.test(email) || email.length > 254) throw new AuthError("INVALID_EMAIL");
  if (password.length < 8 || password.length > 200) throw new AuthError("WEAK_PASSWORD");
}

function isUniqueViolation(err: unknown): boolean {
  for (let current: unknown = err, depth = 0; current && depth < 4; depth += 1) {
    if (typeof current === "object" && "code" in current && (current as { code?: unknown }).code === "23505") return true;
    current = typeof current === "object" && "cause" in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

async function createSession(userId: string) {
  const { db, sessionsTable } = await database();
  // Housekeeping: drop this user's expired sessions whenever a new one starts.
  await db.delete(sessionsTable).where(and(eq(sessionsTable.userId, userId), lt(sessionsTable.expiresAt, new Date())));
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessionsTable).values({ id: sha256(token), userId, expiresAt });
  return { token, expiresAt };
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env["NODE_ENV"] === "production",
    expires: expiresAt,
    path: "/",
  });
}

export async function register(emailInput: string, password: string, name?: string) {
  if (!hasDatabase()) throw new AuthError("ACCOUNTS_UNAVAILABLE");
  const email = normalizeEmail(emailInput);
  validateCredentials(email, password);
  const { db, usersTable } = await database();
  const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing.length) throw new AuthError("EMAIL_TAKEN");
  const user = { id: randomUUID(), email, passwordHash: await hashPassword(password), name: name?.trim().slice(0, 80) || null };
  try {
    await db.insert(usersTable).values(user);
  } catch (err) {
    // Two sign-ups for the same email at once: the unique index decides, the loser gets EMAIL_TAKEN.
    if (isUniqueViolation(err)) throw new AuthError("EMAIL_TAKEN");
    throw err;
  }
  return { user: { id: user.id, email: user.email, name: user.name }, session: await createSession(user.id) };
}

export async function login(emailInput: string, password: string) {
  if (!hasDatabase()) throw new AuthError("ACCOUNTS_UNAVAILABLE");
  const email = normalizeEmail(emailInput);
  const { db, usersTable } = await database();
  const [row] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (!row) {
    await verifyPassword(password, await timingDummyHash());
    throw new AuthError("INVALID_CREDENTIALS");
  }
  if (!(await verifyPassword(password, row.passwordHash))) throw new AuthError("INVALID_CREDENTIALS");
  return { user: { id: row.id, email: row.email, name: row.name }, session: await createSession(row.id) };
}

/** Ends every session of the user (all browsers and devices). Returns how many were ended. */
export async function logoutEverywhere(userId: string) {
  const { db, sessionsTable } = await database();
  const removed = await db.delete(sessionsTable).where(eq(sessionsTable.userId, userId)).returning({ id: sessionsTable.id });
  return removed.length;
}

export async function logout(token: string | undefined) {
  if (!token || !hasDatabase()) return;
  const { db, sessionsTable } = await database();
  await db.delete(sessionsTable).where(eq(sessionsTable.id, sha256(token)));
}

/** Reads the session cookie and attaches req.user. Never fails the request. */
export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token || !hasDatabase()) return next();
  try {
    const { db, sessionsTable, usersTable } = await database();
    const [row] = await db
      .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name })
      .from(sessionsTable)
      .innerJoin(usersTable, eq(usersTable.id, sessionsTable.userId))
      .where(and(eq(sessionsTable.id, sha256(token)), gt(sessionsTable.expiresAt, new Date())))
      .limit(1);
    if (row) req.user = row;
  } catch (err) {
    req.log?.warn({ err }, "Session lookup failed");
  }
  next();
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }
  next();
}

/**
 * Cookie-authenticated writes must come from our own page. Browsers always send Origin
 * on cross-site POSTs, so a mismatch is rejected; requests without Origin (curl, tests) pass.
 */
export function sameOriginWrites(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const origin = req.get("origin");
  if (!origin) return next();
  const allowed = (process.env["ALLOWED_ORIGINS"] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const host = req.get("x-forwarded-host") ?? req.get("host");
  try {
    if (new URL(origin).host === host || allowed.includes(origin)) return next();
  } catch {
    // fall through
  }
  res.status(403).json({ error: "FORBIDDEN_ORIGIN" });
}
