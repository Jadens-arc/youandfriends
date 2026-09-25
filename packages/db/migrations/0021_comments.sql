-- Task `090`: comment threads (anchored by a discriminator for general, timestamp, and lyric
-- threads) and their comments, tombstoned rather than removed; and the comment audit actions.
ALTER TYPE "public"."audit_action" ADD VALUE 'comment.updated' BEFORE 'asset.updated';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'comment.resolved' BEFORE 'asset.updated';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'comment.reopened' BEFORE 'asset.updated';--> statement-breakpoint
CREATE TABLE "comment_threads" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"song_id" varchar(26) NOT NULL,
	"anchor_kind" text NOT NULL,
	"anchor_version_id" varchar(26),
	"anchor_ms" integer,
	"anchor_lyric" jsonb,
	"created_by" varchar(26),
	"resolved_at" timestamp with time zone,
	"resolved_by" varchar(26),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_threads_anchor_kind_known" CHECK (anchor_kind in ('general', 'timestamp', 'lyric')),
	CONSTRAINT "comment_threads_anchor_shape" CHECK ((anchor_kind = 'general' and anchor_version_id is null and anchor_ms is null and anchor_lyric is null)
        or (anchor_kind = 'timestamp' and anchor_version_id is not null and anchor_ms is not null and anchor_ms >= 0 and anchor_lyric is null)
        or (anchor_kind = 'lyric' and anchor_lyric is not null and anchor_version_id is null and anchor_ms is null)),
	CONSTRAINT "comment_threads_resolver_has_time" CHECK (resolved_by is null or resolved_at is not null)
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"thread_id" varchar(26) NOT NULL,
	"author_id" varchar(26),
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"tombstoned_at" timestamp with time zone,
	"tombstoned_by" varchar(26),
	CONSTRAINT "comments_body_length" CHECK (length(body) <= 5000),
	CONSTRAINT "comments_tombstone_erases" CHECK (tombstoned_at is null or body = ''),
	CONSTRAINT "comments_live_has_words" CHECK (tombstoned_at is not null or length(trim(body)) > 0)
);
--> statement-breakpoint
ALTER TABLE "comment_threads" ADD CONSTRAINT "comment_threads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_threads" ADD CONSTRAINT "comment_threads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_threads" ADD CONSTRAINT "comment_threads_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_tombstoned_by_users_id_fk" FOREIGN KEY ("tombstoned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comment_threads_id_workspace_key" ON "comment_threads" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE INDEX "comment_threads_song_idx" ON "comment_threads" USING btree ("workspace_id","song_id","updated_at");--> statement-breakpoint
CREATE INDEX "comments_thread_idx" ON "comments" USING btree ("workspace_id","thread_id","created_at");--> statement-breakpoint

-- A thread's song must be in the thread's own workspace (composite, like `lyrics_documents`).
ALTER TABLE "comment_threads" ADD CONSTRAINT "comment_threads_song_same_workspace"
  FOREIGN KEY ("song_id", "workspace_id")
  REFERENCES "public"."songs"("id", "workspace_id")
  ON DELETE CASCADE;--> statement-breakpoint

-- A comment's thread must be in the comment's own workspace.
ALTER TABLE "comments" ADD CONSTRAINT "comments_thread_same_workspace"
  FOREIGN KEY ("thread_id", "workspace_id")
  REFERENCES "public"."comment_threads"("id", "workspace_id")
  ON DELETE CASCADE;
