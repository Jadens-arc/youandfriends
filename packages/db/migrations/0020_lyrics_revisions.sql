-- Task `084`: earlier drafts of a song's lyrics — automatic snapshots (thinned with age), named
-- checkpoints, and the work in place before each restore (both kept indefinitely) — and the
-- `lyrics.checkpoint_created` audit action.
ALTER TYPE "public"."audit_action" ADD VALUE 'lyrics.checkpoint_created' BEFORE 'comment.created';--> statement-breakpoint
CREATE TABLE "lyrics_revisions" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"song_id" varchar(26) NOT NULL,
	"kind" text NOT NULL,
	"name" text,
	"document" jsonb NOT NULL,
	"plain_text" text DEFAULT '' NOT NULL,
	"source_version" integer NOT NULL,
	"created_by" varchar(26),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lyrics_revisions_kind_known" CHECK (kind in ('automatic', 'checkpoint', 'before_restore')),
	CONSTRAINT "lyrics_revisions_checkpoint_named" CHECK (kind <> 'checkpoint' or (name is not null and length(trim(name)) between 1 and 80)),
	CONSTRAINT "lyrics_revisions_source_version_positive" CHECK (source_version >= 1)
);
--> statement-breakpoint
ALTER TABLE "lyrics_revisions" ADD CONSTRAINT "lyrics_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lyrics_revisions" ADD CONSTRAINT "lyrics_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lyrics_revisions_song_created_idx" ON "lyrics_revisions" USING btree ("workspace_id","song_id","created_at");--> statement-breakpoint

-- The song must be in the row's own workspace (composite, like `lyrics_documents`).
ALTER TABLE "lyrics_revisions" ADD CONSTRAINT "lyrics_revisions_song_same_workspace"
  FOREIGN KEY ("song_id", "workspace_id")
  REFERENCES "public"."songs"("id", "workspace_id")
  ON DELETE CASCADE;
