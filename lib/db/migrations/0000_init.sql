-- Baseline. Written to be safe on a database that already has these tables (for example one created
-- earlier with `drizzle-kit push` or restored from Replit): existing tables, indexes and keys are skipped.
CREATE TABLE IF NOT EXISTS "ad_spend" (
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"channel" text DEFAULT '' NOT NULL,
	"spend" double precision NOT NULL,
	CONSTRAINT "ad_spend_user_id_day_sku_channel_pk" PRIMARY KEY("user_id","day","sku","channel")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"sku" text NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"happened_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"action_key" text NOT NULL,
	"action_type" text NOT NULL,
	"sku" text,
	"object" text NOT NULL,
	"verdict" text NOT NULL,
	"baseline" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "imports" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"file_name" text,
	"rows" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integrations" (
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"url" text,
	"secret" text,
	"status" text NOT NULL,
	"detail" text,
	"meta" jsonb,
	"last_sync_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integrations_user_id_kind_pk" PRIMARY KEY("user_id","kind")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orders" (
	"user_id" text NOT NULL,
	"order_code" text NOT NULL,
	"line_key" text NOT NULL,
	"ordered_at" timestamp with time zone NOT NULL,
	"sku" text NOT NULL,
	"product_name" text,
	"quantity" double precision NOT NULL,
	"amount" double precision NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "orders_user_id_order_code_line_key_pk" PRIMARY KEY("user_id","order_code","line_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "products" (
	"user_id" text NOT NULL,
	"sku" text NOT NULL,
	"name" text,
	"category" text,
	"kaspi_code" text,
	"cost_price" double precision,
	"stock" double precision,
	"lead_time_days" integer,
	"commission_pct" double precision,
	"stock_updated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_user_id_sku_pk" PRIMARY KEY("user_id","sku")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "external_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"channel" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"budget" integer NOT NULL,
	"objective" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"rows" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ad_spend" ADD CONSTRAINT "ad_spend_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "card_events" ADD CONSTRAINT "card_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "imports" ADD CONSTRAINT "imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "integrations" ADD CONSTRAINT "integrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "products" ADD CONSTRAINT "products_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "external_campaigns" ADD CONSTRAINT "external_campaigns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_events_user_idx" ON "card_events" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_user_idx" ON "feedback" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "imports_user_idx" ON "imports" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_user_date_idx" ON "orders" USING btree ("user_id","ordered_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_campaigns_user_idx" ON "external_campaigns" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limits_reset_idx" ON "rate_limits" USING btree ("reset_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sync_runs_one_running" ON "sync_runs" USING btree ("user_id","kind") WHERE "sync_runs"."status" = 'RUNNING';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_runs_user_idx" ON "sync_runs" USING btree ("user_id","started_at");
