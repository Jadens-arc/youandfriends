-- Task `065`: an editor asking for a failed version to be processed again is audited.
ALTER TYPE "public"."audit_action" ADD VALUE 'version.processing_retried' BEFORE 'song.created';