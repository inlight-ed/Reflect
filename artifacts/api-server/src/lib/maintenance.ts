import { sql } from "drizzle-orm";
import { database, hasDatabase } from "./database";
import { logger, safeError } from "./logger";

/** Finished sync runs are only a log for the settings page; the last 90 days are plenty. */
const SYNC_LOG_DAYS = 90;
const DAY_MS = 24 * 60 * 60_000;

export type MaintenanceResult = { sessions: number; syncRuns: number; stuckSyncs: number; counters: number; resetLinks: number; invites: number };

/**
 * Daily housekeeping: removes what only ever grows.
 *  - expired sessions of every user (only the user's own are cleaned at login otherwise)
 *  - finished sync runs older than 90 days
 *  - sync runs still marked RUNNING after a day (the instance died), so they stop looking busy
 *  - expired rate-limit and login-attempt counters
 *  - invitation links that expired or were used more than a day ago
 * Every statement is safe to repeat. A transaction-level advisory lock makes sure that with
 * several API instances only one of them does the work at a time; it returns null for the others.
 */
export async function runMaintenance(): Promise<MaintenanceResult | null> {
  if (!hasDatabase()) return null;
  const { db } = await database();
  return db.transaction(async (tx) => {
    const lock = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(724301) as locked`);
    if (!lock.rows[0]?.locked) return null;
    const count = async (statement: ReturnType<typeof sql>) => Number((await tx.execute(statement)).rowCount ?? 0);
    const sessions = await count(sql`delete from sessions where expires_at < now()`);
    const syncRuns = await count(sql`delete from sync_runs where status <> 'RUNNING' and finished_at < now() - ${`${SYNC_LOG_DAYS} days`}::interval`);
    const stuckSyncs = await count(sql`update sync_runs set status = 'FAILED', detail = 'connector.sync.interrupted', finished_at = now() where status = 'RUNNING' and started_at < now() - interval '1 day'`);
    const counters = await count(sql`delete from rate_limits where reset_at < now() - interval '1 day'`);
    const resetLinks = await count(sql`delete from password_resets where expires_at < now() - interval '1 day'`);
    const invites = await count(sql`delete from workspace_invites where expires_at < now() - interval '1 day' or used_at < now() - interval '1 day'`);
    return { sessions, syncRuns, stuckSyncs, counters, resetLinks, invites };
  });
}

/**
 * Runs the housekeeping shortly after start (a server that restarts often would otherwise never
 * reach a 24 h timer) and then every 24 hours. Failures are logged and retried next time.
 */
export function scheduleMaintenance() {
  const run = async () => {
    try {
      const result = await runMaintenance();
      if (result) logger.info(result, "Maintenance done");
    } catch (err) {
      logger.warn({ err: safeError(err) }, "Maintenance failed; will retry in 24 h");
    }
  };
  setTimeout(() => void run(), 2 * 60_000).unref();
  setInterval(() => void run(), DAY_MS).unref();
}
