-- Task `110`: Mac sync devices and their tokens (ADR 0005). Only a slow hash of each token's
-- secret is stored; where a token may upload is `permission_grants` rows for its subject.
ALTER TYPE "public"."audit_action" ADD VALUE 'sync_token.used' BEFORE 'sync_token.revoked';--> statement-breakpoint
CREATE TABLE "sync_devices" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"name" text NOT NULL,
	"created_by" varchar(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" varchar(26),
	CONSTRAINT "sync_devices_name_length" CHECK (length(name) between 1 and 80),
	CONSTRAINT "sync_devices_revoker_has_time" CHECK (revoked_by is null or revoked_at is not null)
);
--> statement-breakpoint
CREATE TABLE "sync_tokens" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"device_id" varchar(26) NOT NULL,
	"secret_hash" text NOT NULL,
	"created_by" varchar(26) NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"use_audited_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_tokens_secret_is_hashed" CHECK (secret_hash like 'scrypt$%')
);
--> statement-breakpoint
ALTER TABLE "sync_devices" ADD CONSTRAINT "sync_devices_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_devices" ADD CONSTRAINT "sync_devices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_devices" ADD CONSTRAINT "sync_devices_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_tokens" ADD CONSTRAINT "sync_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_tokens" ADD CONSTRAINT "sync_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_devices_id_workspace_key" ON "sync_devices" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE INDEX "sync_devices_workspace_idx" ON "sync_devices" USING btree ("workspace_id","created_by");--> statement-breakpoint
CREATE INDEX "sync_tokens_device_idx" ON "sync_tokens" USING btree ("workspace_id","device_id");--> statement-breakpoint

-- A token belongs to a device in its own workspace, and goes with it.
ALTER TABLE "sync_tokens" ADD CONSTRAINT "sync_tokens_device_same_workspace"
  FOREIGN KEY ("device_id", "workspace_id")
  REFERENCES "public"."sync_devices"("id", "workspace_id") ON DELETE CASCADE;--> statement-breakpoint
-- A device belongs to a member of the workspace. Removing someone removes their devices, and
-- with them every token those devices held: a departed collaborator's Mac stops at once.
ALTER TABLE "sync_devices" ADD CONSTRAINT "sync_devices_member_of_workspace"
  FOREIGN KEY ("workspace_id", "created_by")
  REFERENCES "public"."workspace_memberships"("workspace_id", "user_id") ON DELETE CASCADE;
