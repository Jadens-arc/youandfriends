-- Task `064`: the media pipeline's own record of each job, one row per asset version (the
-- idempotency key). Written `queued` before dispatch so a queue outage leaves an honest row.
CREATE TABLE "media_jobs" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"asset_version_id" varchar(26) NOT NULL,
	"state" "processing_state" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_id" text,
	"last_error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_jobs_attempts_nonnegative" CHECK (attempts >= 0)
);
--> statement-breakpoint
ALTER TABLE "media_jobs" ADD CONSTRAINT "media_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_jobs_asset_version_key" ON "media_jobs" USING btree ("workspace_id","asset_version_id");--> statement-breakpoint
CREATE INDEX "media_jobs_unfinished_idx" ON "media_jobs" USING btree ("workspace_id","state") WHERE state <> 'complete';--> statement-breakpoint

-- Same workspace as the version it processes, enforced by the database rather than by the
-- writer: the pair `(id, workspace_id)` is already unique on `asset_versions`.
ALTER TABLE "media_jobs" ADD CONSTRAINT "media_jobs_asset_version_same_workspace"
  FOREIGN KEY ("asset_version_id", "workspace_id")
  REFERENCES "public"."asset_versions"("id", "workspace_id")
  ON DELETE CASCADE;
