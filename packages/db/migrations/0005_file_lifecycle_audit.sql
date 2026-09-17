-- ── Audit actions for the file layer ──────────────────────────────────────────────────────
--
-- Task `028` widened the delete/restore/purge cascade to `assets` and `snapshots`, and the
-- rule that module keeps is one audit event per row touched. A stem or a snapshot that
-- disappears inside somebody else's event is a row whose disappearance nobody can explain.
--
-- Additive only. `ALTER TYPE ... ADD VALUE` cannot use the new value in the same transaction
-- that adds it, which is fine here because nothing writes one until this has committed.
--
-- `asset.deleted` already existed and was never emitted — task `025` claimed it and the
-- planner it was written for could not reach an asset.

ALTER TYPE "public"."audit_action" ADD VALUE 'snapshot.deleted' BEFORE 'comment.deleted';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'asset.restored' BEFORE 'lyrics.revision_restored';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'snapshot.restored' BEFORE 'lyrics.revision_restored';--> statement-breakpoint
ALTER TYPE "public"."audit_target_type" ADD VALUE 'snapshot' BEFORE 'version';