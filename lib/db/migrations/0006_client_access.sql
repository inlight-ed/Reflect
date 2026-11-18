CREATE TABLE "workspace_invite_clients" (
	"token_hash" text NOT NULL,
	"client_id" text NOT NULL,
	CONSTRAINT "workspace_invite_clients_token_hash_client_id_pk" PRIMARY KEY("token_hash","client_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_member_clients" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	CONSTRAINT "workspace_member_clients_workspace_id_user_id_client_id_pk" PRIMARY KEY("workspace_id","user_id","client_id")
);
--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD COLUMN "all_clients" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN "all_clients" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_invite_clients" ADD CONSTRAINT "workspace_invite_clients_token_hash_workspace_invites_token_hash_fk" FOREIGN KEY ("token_hash") REFERENCES "public"."workspace_invites"("token_hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invite_clients" ADD CONSTRAINT "workspace_invite_clients_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member_clients" ADD CONSTRAINT "workspace_member_clients_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member_clients" ADD CONSTRAINT "workspace_member_clients_member_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_members"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_member_clients_client_idx" ON "workspace_member_clients" USING btree ("client_id");