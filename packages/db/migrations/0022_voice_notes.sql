-- Task `093`: voice notes. Assets record who made them (a voice note's recording may be uploaded
-- only by its creator), and a comment may carry a voice note instead of, or beside, its words.
ALTER TABLE "comments" DROP CONSTRAINT "comments_live_has_words";--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "created_by" varchar(26);--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "voice_note_asset_id" varchar(26);--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comments_voice_note_key" ON "comments" USING btree ("voice_note_asset_id") WHERE voice_note_asset_id is not null;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_tombstone_drops_voice" CHECK (tombstoned_at is null or voice_note_asset_id is null);--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_live_has_words" CHECK (tombstoned_at is not null or length(trim(body)) > 0 or voice_note_asset_id is not null);--> statement-breakpoint

-- The voice note must be an asset in the comment's own workspace. Not cascading: purging a
-- recording must never delete the comment around it (deleting a comment trashes its recording
-- instead). **Deferred**, because purging a song removes the comment and its recording through
-- two separate cascades in one statement, and an immediate check runs between them — which made
-- every song with a voice note on it unpurgeable (found by the purge fixture in task `093`).
-- Checked at commit, the purge passes; purging a recording a live comment still carries does not.
ALTER TABLE "comments" ADD CONSTRAINT "comments_voice_note_same_workspace"
  FOREIGN KEY ("voice_note_asset_id", "workspace_id")
  REFERENCES "public"."assets"("id", "workspace_id")
  DEFERRABLE INITIALLY DEFERRED;
