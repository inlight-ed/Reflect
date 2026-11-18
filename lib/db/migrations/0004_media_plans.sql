CREATE TABLE "media_placements" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"user_id" text NOT NULL,
	"position" integer NOT NULL,
	"variant" text NOT NULL,
	"platform" text NOT NULL,
	"format" text NOT NULL,
	"mechanic" text,
	"buy_type" text,
	"period" text,
	"cost" double precision,
	"plan_impressions" double precision,
	"plan_reach" double precision,
	"plan_clicks" double precision,
	"plan_ctr" double precision,
	"expected_effect" text,
	"fact_cost" double precision,
	"fact_impressions" double precision,
	"fact_reach" double precision,
	"fact_clicks" double precision,
	"fact_updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "media_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"client" text NOT NULL,
	"title" text NOT NULL,
	"file_name" text,
	"checks" text DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_placements" ADD CONSTRAINT "media_placements_plan_id_media_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."media_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_placements" ADD CONSTRAINT "media_placements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_plans" ADD CONSTRAINT "media_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_placements_plan_idx" ON "media_placements" USING btree ("plan_id","position");--> statement-breakpoint
CREATE INDEX "media_placements_user_idx" ON "media_placements" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "media_plans_user_idx" ON "media_plans" USING btree ("user_id","created_at");