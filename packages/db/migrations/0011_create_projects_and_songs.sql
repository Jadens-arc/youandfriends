-- Task `046`: creating projects and songs is audited.
--
-- Two new `audit_action` values. `ADD VALUE` cannot be used in the transaction that adds it,
-- which is fine: nothing here writes one, and the web app only does once this has committed.
ALTER TYPE "public"."audit_action" ADD VALUE 'song.created' BEFORE 'song.updated';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'project.created' BEFORE 'project.updated';