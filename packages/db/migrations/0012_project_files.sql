-- Task `057`: Project Files organization.
--
-- Additive. `asset.updated` audits renaming, moving, and tagging a file; it is not used in this
-- transaction. The GIN index serves filtering by tag. Tags stay on `assets.tags`: they are
-- workspace-scoped because every asset is, and the workspace's vocabulary is the distinct set of
-- them — one source of truth rather than an array and a join table that can disagree.
ALTER TYPE "public"."audit_action" ADD VALUE 'asset.updated' BEFORE 'asset.downloaded';--> statement-breakpoint
CREATE INDEX "assets_tags_idx" ON "assets" USING gin ("tags");