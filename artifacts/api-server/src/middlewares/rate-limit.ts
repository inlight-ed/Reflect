import type { NextFunction, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { database, hasDatabase } from "../lib/database";

type Options = { windowMs: number; max: number; name: string; shared?: boolean };

/**
 * Fixed-window limiter. Keyed by the signed-in user when there is one, otherwise by IP.
 *
 * `shared: true` keeps the counters in Postgres so the limit holds across API instances
 * (used for login, AI, imports and syncs). If the database is unavailable it falls back to
 * the in-memory counter rather than blocking the request. The global per-request limit stays
 * in memory so ordinary requests do not pay a database round trip.
 */
export function rateLimit({ windowMs, max, name, shared = false }: Options) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, windowMs);
  sweep.unref();

  const local = (key: string, now: number) => {
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      hits.set(key, fresh);
      return fresh;
    }
    entry.count += 1;
    return entry;
  };

  const remote = async (key: string) => {
    const { db } = await database();
    const result = await db.execute<{ count: number; reset_at: Date | string }>(sql`
      insert into rate_limits (key, count, reset_at) values (${key}, 1, now() + ${`${windowMs} milliseconds`}::interval)
      on conflict (key) do update set
        count = case when rate_limits.reset_at <= now() then 1 else rate_limits.count + 1 end,
        reset_at = case when rate_limits.reset_at <= now() then now() + ${`${windowMs} milliseconds`}::interval else rate_limits.reset_at end
      returning count, reset_at`);
    const row = result.rows[0]!;
    return { count: Number(row.count), resetAt: new Date(row.reset_at).getTime() };
  };

  return async (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = `${name}:${req.user ? `u:${req.user.id}` : `ip:${req.ip ?? "unknown"}`}`;
    let entry: { count: number; resetAt: number };
    if (shared && hasDatabase()) {
      try {
        entry = await remote(key);
      } catch (err) {
        req.log?.warn({ err }, "Shared rate limit unavailable; using in-memory counter");
        entry = local(key, now);
      }
    } else entry = local(key, now);
    if (entry.count > max) {
      res.setHeader("Retry-After", Math.max(1, Math.ceil((entry.resetAt - now) / 1000)));
      res.status(429).json({ error: "RATE_LIMITED" });
      return;
    }
    next();
  };
}

/** Deletes expired counters; called occasionally so the table stays small. */
export async function pruneRateLimits() {
  if (!hasDatabase()) return;
  const { db } = await database();
  await db.execute(sql`delete from rate_limits where reset_at < now() - interval '1 day'`);
}
