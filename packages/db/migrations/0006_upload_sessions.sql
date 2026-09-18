CREATE TYPE "public"."upload_state" AS ENUM('pending', 'completed', 'aborted', 'expired');--> statement-breakpoint
CREATE TABLE "upload_parts" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"session_id" varchar(26) NOT NULL,
	"part_number" integer NOT NULL,
	"etag" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_parts_number_range" CHECK (part_number between 1 and 10000),
	CONSTRAINT "upload_parts_size_positive" CHECK (size_bytes > 0)
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"owner_user_id" varchar(26) NOT NULL,
	"asset_id" varchar(26) NOT NULL,
	"object_key" text NOT NULL,
	"upload_id" text,
	"max_size_bytes" bigint NOT NULL,
	"content_type_hint" text NOT NULL,
	"part_size_bytes" integer NOT NULL,
	"expected_checksum_sha256" text,
	"state" "upload_state" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"storage_object_id" varchar(26),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_sessions_max_size_positive" CHECK (max_size_bytes > 0),
	CONSTRAINT "upload_sessions_part_size_minimum" CHECK (part_size_bytes >= 5242880)
);
--> statement-breakpoint
ALTER TABLE "upload_parts" ADD CONSTRAINT "upload_parts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_parts" ADD CONSTRAINT "upload_parts_session_id_upload_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."upload_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_storage_object_id_storage_objects_id_fk" FOREIGN KEY ("storage_object_id") REFERENCES "public"."storage_objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "upload_parts_session_number_key" ON "upload_parts" USING btree ("session_id","part_number");--> statement-breakpoint
CREATE INDEX "upload_parts_workspace_session_idx" ON "upload_parts" USING btree ("workspace_id","session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "upload_sessions_id_workspace_key" ON "upload_sessions" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "upload_sessions_object_key_key" ON "upload_sessions" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "upload_sessions_workspace_state_idx" ON "upload_sessions" USING btree ("workspace_id","state");--> statement-breakpoint
CREATE INDEX "upload_sessions_expiry_idx" ON "upload_sessions" USING btree ("expires_at") WHERE state = 'pending';--> statement-breakpoint

-- ── Tenancy travels with every reference ──────────────────────────────────────────────────
--
-- The same rule the file layer follows (task `026`, proven by task `007`): each pair references
-- the `(id, workspace_id)` unique key, so "this session's asset is in this session's workspace"
-- is a fact the database keeps rather than a claim the application makes.
--
-- It matters more here than almost anywhere. A session pointing at another workspace's asset is
-- a finalize that attaches an upload to somebody else's song — which is `docs/THREAT_MODEL.md`
-- T4's whole subject, and a row a scoped read would render as if it belonged.
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_asset_same_workspace"
  FOREIGN KEY ("asset_id", "workspace_id") REFERENCES "assets" ("id", "workspace_id")
  ON DELETE CASCADE;--> statement-breakpoint

-- `SET NULL` names its column. A bare one on a composite key nulls every referencing column,
-- `workspace_id` included, which task `026` learned the hard way on `songs.current_version_id`.
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_object_same_workspace"
  FOREIGN KEY ("storage_object_id", "workspace_id")
  REFERENCES "storage_objects" ("id", "workspace_id")
  ON DELETE SET NULL ("storage_object_id");--> statement-breakpoint

ALTER TABLE "upload_parts" ADD CONSTRAINT "upload_parts_session_same_workspace"
  FOREIGN KEY ("session_id", "workspace_id")
  REFERENCES "upload_sessions" ("id", "workspace_id")
  ON DELETE CASCADE;--> statement-breakpoint

CREATE TRIGGER upload_sessions_set_updated_at BEFORE UPDATE ON "upload_sessions"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
