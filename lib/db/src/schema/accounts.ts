import { sql } from "drizzle-orm";
import { doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** One account per person. Email is stored lower-cased. Data belongs to workspaces, not to people. */
export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A workspace owns all data: a seller's shop, or an agency with its clients. A person signs in once
 * and works in every workspace they are a member of; the session remembers which one is open.
 */
export const workspacesTable = pgTable("workspaces", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(), // SHOP | AGENCY
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** OWNER manages members, MEMBER reads and writes data, VIEWER only reads. */
export const workspaceMembersTable = pgTable("workspace_members", {
  workspaceId: text("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.workspaceId, table.userId] }), index("workspace_members_user_idx").on(table.userId)]);

/**
 * Invitation links. The owner sends the link himself, so nothing reveals whether an email has an
 * account. Only the sha256 of the token is stored; a link works once and expires after 7 days.
 */
export const workspaceInvitesTable = pgTable("workspace_invites", {
  tokenHash: text("token_hash").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  createdBy: text("created_by").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  usedBy: text("used_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("workspace_invites_workspace_idx").on(table.workspaceId)]);

/** An agency's client (a brand). Media plans belong to a client. */
export const clientsTable = pgTable("clients", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("clients_workspace_name_idx").on(table.workspaceId, sql`lower(${table.name})`)]);

/** Session ids are stored hashed (sha256), so a database leak does not expose live cookies. */
export const sessionsTable = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  /** The workspace open in this session; empty means the person's first workspace. */
  workspaceId: text("workspace_id").references(() => workspacesTable.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("sessions_user_idx").on(table.userId)]);

/**
 * One-time password reset links. Only the sha256 of the token is stored, so a database leak does
 * not hand out working links. A link works once and expires after an hour.
 */
export const passwordResetsTable = pgTable("password_resets", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("password_resets_user_idx").on(table.userId)]);

/** Catalogue facts the marketplace does not know: cost, stock, lead time, commission. */
export const productsTable = pgTable("products", {
  workspaceId: text("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  sku: text("sku").notNull(),
  name: text("name"),
  category: text("category"),
  kaspiCode: text("kaspi_code"),
  costPrice: doublePrecision("cost_price"),
  stock: doublePrecision("stock"),
  leadTimeDays: integer("lead_time_days"),
  commissionPct: doublePrecision("commission_pct"),
  /** Per unit, ₸: delivery the seller pays, and other costs such as packaging. */
  logisticsCost: doublePrecision("logistics_cost"),
  otherCost: doublePrecision("other_cost"),
  stockUpdatedAt: timestamp("stock_updated_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.workspaceId, table.sku] })]);

/** One row per order line. Status is normalised to SOLD, PENDING, CANCELLED or RETURNED. */
export const ordersTable = pgTable("orders", {
  workspaceId: text("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  orderCode: text("order_code").notNull(),
  lineKey: text("line_key").notNull(),
  orderedAt: timestamp("ordered_at", { withTimezone: true }).notNull(),
  sku: text("sku").notNull(),
  productName: text("product_name"),
  quantity: doublePrecision("quantity").notNull(),
  amount: doublePrecision("amount").notNull(),
  status: text("status").notNull(),
  source: text("source").notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.orderCode, table.lineKey] }),
  index("orders_workspace_date_idx").on(table.workspaceId, table.orderedAt),
]);

/** Advertising spend by day (or month start), optionally per SKU and channel. */
export const adSpendTable = pgTable("ad_spend", {
  workspaceId: text("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  day: text("day").notNull(),
  sku: text("sku").notNull().default(""),
  channel: text("channel").notNull().default(""),
  spend: doublePrecision("spend").notNull(),
}, (table) => [primaryKey({ columns: [table.workspaceId, table.day, table.sku, table.channel] })]);

export const importsTable = pgTable("imports", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  source: text("source").notNull(),
  fileName: text("file_name"),
  rows: integer("rows").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("imports_workspace_idx").on(table.workspaceId)]);

/** "Worked / did not work / too early" verdicts on recommendations, with the numbers at the time. */
export const feedbackTable = pgTable("feedback", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  actionKey: text("action_key").notNull(),
  actionType: text("action_type").notNull(),
  sku: text("sku"),
  object: text("object").notNull(),
  verdict: text("verdict").notNull(),
  baseline: jsonb("baseline"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("feedback_workspace_idx").on(table.workspaceId)]);

/** Card changes the seller logs (new photo, title, price) to compare sales before and after. */
export const cardEventsTable = pgTable("card_events", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  sku: text("sku").notNull(),
  kind: text("kind").notNull(),
  note: text("note"),
  happenedAt: timestamp("happened_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("card_events_workspace_idx").on(table.workspaceId)]);

/** Connected services. Secrets are AES-256-GCM encrypted with the server key. */
export const integrationsTable = pgTable("integrations", {
  workspaceId: text("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  url: text("url"),
  secret: text("secret"),
  status: text("status").notNull(),
  detail: text("detail"),
  meta: jsonb("meta"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.workspaceId, table.kind] })]);
