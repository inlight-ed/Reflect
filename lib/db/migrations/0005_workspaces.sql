CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);--> statement-breakpoint
CREATE TABLE "workspace_invites" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"role" text NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
-- Every existing person gets a personal workspace with the same id as the account, so all rows
-- they own keep their key; only the column name and the foreign key change. A person who only
-- keeps media plans (no orders) gets an agency workspace.
INSERT INTO "workspaces" ("id", "kind", "name", "created_at")
SELECT u."id",
	CASE WHEN EXISTS (SELECT 1 FROM "media_plans" m WHERE m."user_id" = u."id") AND NOT EXISTS (SELECT 1 FROM "orders" o WHERE o."user_id" = u."id") THEN 'AGENCY' ELSE 'SHOP' END,
	COALESCE(NULLIF(u."name", ''), split_part(u."email", '@', 1)),
	u."created_at"
FROM "users" u;--> statement-breakpoint
INSERT INTO "workspace_members" ("workspace_id", "user_id", "role", "created_at") SELECT "id", "id", 'OWNER', "created_at" FROM "users";--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "ad_spend" DROP CONSTRAINT "ad_spend_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "ad_spend" DROP CONSTRAINT "ad_spend_user_id_day_sku_channel_pk";--> statement-breakpoint
ALTER TABLE "ad_spend" RENAME COLUMN "user_id" TO "workspace_id";--> statement-breakpoint
ALTER TABLE "ad_spend" ADD CONSTRAINT "ad_spend_workspace_id_day_sku_channel_pk" PRIMARY KEY("workspace_id","day","sku","channel");--> statement-breakpoint
ALTER TABLE "card_events" DROP CONSTRAINT "card_events_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "card_events" RENAME COLUMN "user_id" TO "workspace_id";--> statement-breakpoint
ALTER INDEX "card_events_user_idx" RENAME TO "card_events_workspace_idx";--> statement-breakpoint
ALTER TABLE "feedback" DROP CONSTRAINT "feedback_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "feedback" RENAME COLUMN "user_id" TO "workspace_id";--> statement-breakpoint
ALTER INDEX "feedback_user_idx" RENAME TO "feedback_workspace_idx";--> statement-breakpoint
ALTER TABLE "imports" DROP CONSTRAINT "imports_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "imports" RENAME COLUMN "user_id" TO "workspace_id";--> statement-breakpoint
ALTER INDEX "imports_user_idx" RENAME TO "imports_workspace_idx";--> statement-breakpoint
ALTER TABLE "integrations" DROP CONSTRAINT "integrations_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "integrations" DROP CONSTRAINT "integrations_user_id_kind_pk";--> statement-breakpoint
ALTER TABLE "integrations" RENAME COLUMN "user_id" TO "workspace_id";--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_workspace_id_kind_pk" PRIMARY KEY("workspace_id","kind");--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_user_id_order_code_line_key_pk";--> statement-breakpoint
ALTER TABLE "orders" RENAME COLUMN "user_id" TO "workspace_id";--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_workspace_id_order_code_line_key_pk" PRIMARY KEY("workspace_id","order_code","line_key");--> statement-breakpoint
ALTER INDEX "orders_user_date_idx" RENAME TO "orders_workspace_date_idx";--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_user_id_sku_pk";--> statement-breakpoint
ALTER TABLE "products" RENAME COLUMN "user_id" TO "workspace_id";--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_workspace_id_sku_pk" PRIMARY KEY("workspace_id","sku");--> statement-breakpoint
ALTER TABLE "external_campaigns" DROP CONSTRAINT "external_campaigns_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "external_campaigns" RENAME COLUMN "user_id" TO "workspace_id";--> statement-breakpoint
ALTER INDEX "external_campaigns_user_idx" RENAME TO "external_campaigns_workspace_idx";--> statement-breakpoint
ALTER TABLE "media_placements" DROP CONSTRAINT "media_placements_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "media_placements" RENAME COLUMN "user_id" TO "workspace_id";--> statement-breakpoint
ALTER INDEX "media_placements_user_idx" RENAME TO "media_placements_workspace_idx";--> statement-breakpoint
ALTER TABLE "media_plans" DROP CONSTRAINT "media_plans_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "media_plans" RENAME COLUMN "user_id" TO "workspace_id";--> statement-breakpoint
ALTER INDEX "media_plans_user_idx" RENAME TO "media_plans_workspace_idx";--> statement-breakpoint
ALTER TABLE "sync_runs" DROP CONSTRAINT "sync_runs_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "sync_runs" RENAME COLUMN "user_id" TO "workspace_id";--> statement-breakpoint
ALTER INDEX "sync_runs_user_idx" RENAME TO "sync_runs_workspace_idx";--> statement-breakpoint
-- Media plans named their client in free text; each distinct name becomes a client.
INSERT INTO "clients" ("id", "workspace_id", "name", "created_at")
SELECT gen_random_uuid()::text, "workspace_id", min(trim("client")), min("created_at") FROM "media_plans" GROUP BY "workspace_id", lower(trim("client"));--> statement-breakpoint
ALTER TABLE "media_plans" ADD COLUMN "client_id" text;--> statement-breakpoint
UPDATE "media_plans" m SET "client_id" = c."id" FROM "clients" c WHERE c."workspace_id" = m."workspace_id" AND lower(c."name") = lower(trim(m."client"));--> statement-breakpoint
ALTER TABLE "media_plans" ALTER COLUMN "client_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "media_plans" DROP COLUMN "client";--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_plans" ADD CONSTRAINT "media_plans_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_spend" ADD CONSTRAINT "ad_spend_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_events" ADD CONSTRAINT "card_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_campaigns" ADD CONSTRAINT "external_campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_placements" ADD CONSTRAINT "media_placements_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_plans" ADD CONSTRAINT "media_plans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clients_workspace_name_idx" ON "clients" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE INDEX "workspace_invites_workspace_idx" ON "workspace_invites" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "media_plans_client_idx" ON "media_plans" USING btree ("client_id");
