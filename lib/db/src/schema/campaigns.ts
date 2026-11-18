import { date, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { workspacesTable } from "./accounts";

/** External campaigns that people add on the /external-media page. Demo seed campaigns are not stored. */
export const externalCampaignsTable = pgTable("external_campaigns", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").references(() => workspacesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  channel: text("channel").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  budget: integer("budget").notNull(),
  objective: text("objective").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("external_campaigns_workspace_idx").on(table.workspaceId)]);

export type ExternalCampaignRow = typeof externalCampaignsTable.$inferSelect;
