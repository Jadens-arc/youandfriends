-- Task `061`: loudness range, and why loudness is unavailable when it is. Analysis columns —
-- outside the immutability trigger's list, like the rest of what is learned about the bytes.
ALTER TABLE "asset_versions" ADD COLUMN "loudness_range_lu" real;--> statement-breakpoint
ALTER TABLE "asset_versions" ADD COLUMN "loudness_unavailable" text;--> statement-breakpoint
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_loudness_unavailable_known" CHECK (loudness_unavailable is null or loudness_unavailable in ('silent', 'too_short', 'unreadable'));