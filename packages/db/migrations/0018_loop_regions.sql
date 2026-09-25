-- Task `074`: one person's loop region on one song, never shared between collaborators.
CREATE TABLE "loop_regions" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"user_id" varchar(26) NOT NULL,
	"song_id" varchar(26) NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loop_regions_bounds" CHECK (start_ms >= 0 and end_ms > start_ms)
);
--> statement-breakpoint
ALTER TABLE "loop_regions" ADD CONSTRAINT "loop_regions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loop_regions" ADD CONSTRAINT "loop_regions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "loop_regions_user_song_key" ON "loop_regions" USING btree ("workspace_id","user_id","song_id");--> statement-breakpoint

-- The song must be in the row's own workspace: composite, like `media_jobs`'s version reference.
ALTER TABLE "loop_regions" ADD CONSTRAINT "loop_regions_song_same_workspace"
  FOREIGN KEY ("song_id", "workspace_id")
  REFERENCES "public"."songs"("id", "workspace_id")
  ON DELETE CASCADE;
