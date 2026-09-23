-- Task `054`: browser folder snapshots.
--
-- Additive. `snapshot_entries.ignore_reason` keeps the sentence a person was shown for a file
-- left out of a snapshot; `snapshots.asset_id` names the Project Files asset whose version holds
-- the ZIP, set before the upload so finalize can check it is handed *this* snapshot's upload.
ALTER TABLE "snapshot_entries" ADD COLUMN "ignore_reason" text;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "asset_id" varchar(26);--> statement-breakpoint

-- The asset is in the snapshot's own workspace, provably: the composite reference carries the
-- workspace with it. `SET NULL ("asset_id")` names the column so that purging the asset clears
-- only the reference — a bare `SET NULL` would null `workspace_id` too, which is NOT NULL.
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_asset_same_workspace"
  FOREIGN KEY ("asset_id", "workspace_id")
  REFERENCES "assets" ("id", "workspace_id")
  ON DELETE SET NULL ("asset_id");
