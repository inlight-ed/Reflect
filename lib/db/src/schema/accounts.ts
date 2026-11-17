import { doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/** One account per seller. Email is stored lower-cased. */
export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Session ids are stored hashed (sha256), so a database leak does not expose live cookies. */
export const sessionsTable = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
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
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
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
}, (table) => [primaryKey({ columns: [table.userId, table.sku] })]);

/** One row per order line. Status is normalised to SOLD, PENDING, CANCELLED or RETURNED. */
export const ordersTable = pgTable("orders", {
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
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
  primaryKey({ columns: [table.userId, table.orderCode, table.lineKey] }),
  index("orders_user_date_idx").on(table.userId, table.orderedAt),
]);

/** Advertising spend by day (or month start), optionally per SKU and channel. */
export const adSpendTable = pgTable("ad_spend", {
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  day: text("day").notNull(),
  sku: text("sku").notNull().default(""),
  channel: text("channel").notNull().default(""),
  spend: doublePrecision("spend").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.day, table.sku, table.channel] })]);

export const importsTable = pgTable("imports", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  source: text("source").notNull(),
  fileName: text("file_name"),
  rows: integer("rows").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("imports_user_idx").on(table.userId)]);

/** "Worked / did not work / too early" verdicts on recommendations, with the numbers at the time. */
export const feedbackTable = pgTable("feedback", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  actionKey: text("action_key").notNull(),
  actionType: text("action_type").notNull(),
  sku: text("sku"),
  object: text("object").notNull(),
  verdict: text("verdict").notNull(),
  baseline: jsonb("baseline"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("feedback_user_idx").on(table.userId)]);

/** Card changes the seller logs (new photo, title, price) to compare sales before and after. */
export const cardEventsTable = pgTable("card_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  sku: text("sku").notNull(),
  kind: text("kind").notNull(),
  note: text("note"),
  happenedAt: timestamp("happened_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("card_events_user_idx").on(table.userId)]);

/** Connected services. Secrets are AES-256-GCM encrypted with the server key. */
export const integrationsTable = pgTable("integrations", {
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  url: text("url"),
  secret: text("secret"),
  status: text("status").notNull(),
  detail: text("detail"),
  meta: jsonb("meta"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.userId, table.kind] })]);
