-- Task `080`: one song's lyrics — canonical Tiptap JSON, the derived plain text with a generated,
-- GIN-indexed search vector, the Yjs state, and an optimistic-concurrency version.
CREATE TABLE "lyrics_documents" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"song_id" varchar(26) NOT NULL,
	"document" jsonb NOT NULL,
	"plain_text" text DEFAULT '' NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', plain_text)) STORED,
	"yjs_state" "bytea",
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" varchar(26),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lyrics_documents_version_positive" CHECK (version >= 1)
);
--> statement-breakpoint
ALTER TABLE "lyrics_documents" ADD CONSTRAINT "lyrics_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lyrics_documents" ADD CONSTRAINT "lyrics_documents_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lyrics_documents_song_key" ON "lyrics_documents" USING btree ("workspace_id","song_id");--> statement-breakpoint
CREATE INDEX "lyrics_documents_search_idx" ON "lyrics_documents" USING gin ("search");--> statement-breakpoint

-- The song must be in the row's own workspace (composite, like `loop_regions`).
ALTER TABLE "lyrics_documents" ADD CONSTRAINT "lyrics_documents_song_same_workspace"
  FOREIGN KEY ("song_id", "workspace_id")
  REFERENCES "public"."songs"("id", "workspace_id")
  ON DELETE CASCADE;
