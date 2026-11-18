import { doublePrecision, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { clientsTable, workspacesTable } from "./accounts";

/**
 * A media plan as the agency builds it: one file, one client, one or several budget variants
 * (Light / Medium / Max). Placements keep the plan as written and, once the flight has run,
 * the fact the platform reported, so delivery and the real price of a contact can be compared.
 */
export const mediaPlansTable = pgTable("media_plans", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  fileName: text("file_name"),
  /** Issues found when the plan was read, e.g. a total that does not match its rows (JSON). */
  checks: text("checks").notNull().default("[]"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("media_plans_workspace_idx").on(table.workspaceId, table.createdAt), index("media_plans_client_idx").on(table.clientId)]);

export const mediaPlacementsTable = pgTable("media_placements", {
  id: text("id").primaryKey(),
  planId: text("plan_id").notNull().references(() => mediaPlansTable.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  variant: text("variant").notNull(),
  platform: text("platform").notNull(),
  format: text("format").notNull(),
  mechanic: text("mechanic"),
  buyType: text("buy_type"),
  period: text("period"),
  cost: doublePrecision("cost"),
  planImpressions: doublePrecision("plan_impressions"),
  planReach: doublePrecision("plan_reach"),
  planClicks: doublePrecision("plan_clicks"),
  planCtr: doublePrecision("plan_ctr"),
  expectedEffect: text("expected_effect"),
  factCost: doublePrecision("fact_cost"),
  factImpressions: doublePrecision("fact_impressions"),
  factReach: doublePrecision("fact_reach"),
  factClicks: doublePrecision("fact_clicks"),
  factUpdatedAt: timestamp("fact_updated_at", { withTimezone: true }),
}, (table) => [
  index("media_placements_plan_idx").on(table.planId, table.position),
  index("media_placements_workspace_idx").on(table.workspaceId),
]);

export type MediaPlanRow = typeof mediaPlansTable.$inferSelect;
export type MediaPlacementRow = typeof mediaPlacementsTable.$inferSelect;
