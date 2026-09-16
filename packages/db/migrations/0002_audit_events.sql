CREATE TYPE "public"."audit_action" AS ENUM('auth.signed_in', 'auth.signed_out', 'auth.session_revoked', 'access.granted', 'access.denied', 'share.link_created', 'share.link_revoked', 'share.link_accessed', 'permission.granted', 'permission.revoked', 'permission.changed', 'upload.started', 'upload.completed', 'upload.aborted', 'version.created', 'song.updated', 'project.updated', 'folder.updated', 'folder.moved', 'lyrics.updated', 'comment.created', 'asset.downloaded', 'version.downloaded', 'song.deleted', 'project.deleted', 'folder.deleted', 'asset.deleted', 'comment.deleted', 'song.restored', 'project.restored', 'folder.restored', 'lyrics.revision_restored', 'member.added', 'member.removed', 'member.role_changed', 'workspace.settings_changed', 'sync_token.issued', 'sync_token.revoked');--> statement-breakpoint
CREATE TYPE "public"."audit_target_type" AS ENUM('workspace', 'folder', 'project', 'song', 'asset', 'version', 'lyrics', 'comment', 'member', 'permission_grant', 'share_link', 'sync_token', 'session', 'upload_session');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"actor_kind" "subject_kind" NOT NULL,
	"actor_id" varchar(26),
	"action" "audit_action" NOT NULL,
	"target_type" "audit_target_type" NOT NULL,
	"target_id" varchar(26),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"correlation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_workspace_time_idx" ON "audit_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("workspace_id","actor_kind","actor_id");--> statement-breakpoint
CREATE INDEX "audit_events_target_idx" ON "audit_events" USING btree ("workspace_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("workspace_id","action");--> statement-breakpoint
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Append-only, enforced by the database.
--
-- Audit integrity is itself a security property. A log that can be edited is a log that
-- cannot be relied on during the one investigation it exists for, and "we only ever insert"
-- is a convention, not a control — it holds until the first cleanup script.
--
-- This rejects UPDATE, DELETE, and TRUNCATE for every caller, including the owner role the
-- application connects as. A dedicated role without those privileges would also work, but it
-- would mean a second connection string in every deployment; this holds regardless of who is
-- connected.
--
-- Note that `audit_events.workspace_id` deliberately does **not** cascade. A cascading delete
-- issues a real DELETE against this table and so trips this trigger, which would make
-- deleting a workspace fail confusingly. Refusing it at the foreign key is the clearer
-- statement: purging a tenant's history is a deliberate retention procedure, not a side
-- effect of deleting something else.
-- ─────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION audit_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege',
          HINT = 'Audit history is never rewritten. Record a corrective event instead.';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();--> statement-breakpoint

CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();--> statement-breakpoint

-- `TRUNCATE` bypasses row-level triggers entirely, so it needs its own statement-level one.
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON "audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_append_only();
