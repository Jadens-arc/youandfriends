-- Task `056`: the mix version stack.
--
-- Additive only. One mix version per asset version makes recording a finished upload as a mix
-- idempotent: a replay finds the row the first call made instead of stacking the same bytes
-- twice. No existing row can violate it — nothing has yet written a mix version.
--
-- Deliberately *not* unique: `asset_versions.storage_object_id`. Two versions may share one
-- object (de-duplication by checksum is anticipated, and task `028`'s purge reasons about
-- exactly that sharing). Recording an upload's asset version is idempotent instead through a
-- row lock on the asset and an existence check inside it.
--
-- `upload_sessions.filename` and `asset_versions.original_filename` carry the uploader's own
-- filename to the version, so a downloaded original is saved under its real name. Neither is
-- part of any key, and `original_filename` is outside the immutability trigger's columns: it
-- describes the bytes, it does not identify them.
ALTER TABLE "upload_sessions" ADD COLUMN "filename" text;--> statement-breakpoint
ALTER TABLE "asset_versions" ADD COLUMN "original_filename" text;--> statement-breakpoint
CREATE UNIQUE INDEX "mix_versions_asset_version_key" ON "mix_versions" USING btree ("workspace_id","asset_version_id");