import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./accounts";

/** Fixed-window counters shared by every API instance (login, AI, import and sync limits). */
export const rateLimitsTable = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
}, (table) => [index("rate_limits_reset_idx").on(table.resetAt)]);

/**
 * One row per integration sync. The partial unique index allows only one RUNNING sync per
 * user and source across all instances, which is the sync lock; finished rows are the run log.
 */
export const syncRunsTable = pgTable("sync_runs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  status: text("status").notNull(), // RUNNING | DONE | FAILED
  detail: text("detail"),
  rows: integer("rows"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  // Refreshed every minute by the instance that owns the run, also while it waits in the queue.
  // A RUNNING row whose heartbeat stopped belongs to an instance that died: it is resumed.
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("sync_runs_one_running").on(table.userId, table.kind).where(sql`${table.status} = 'RUNNING'`),
  index("sync_runs_user_idx").on(table.userId, table.startedAt),
]);
