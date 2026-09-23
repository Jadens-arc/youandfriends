-- ── Workspace provisioning and cached storage usage (task `031`) ──────────────────────────
--
-- Additive only: two nullable-or-defaulted columns, a unique index over a column that is null on
-- every existing row, and one enum value. Nothing existing is rewritten.
--
-- `provisioned_for_user_id` is what makes first-sign-in provisioning race-safe. Several requests
-- arrive together on a first sign-in and every one of them sees a person with no workspace; the
-- unique key turns every insert after the first into a conflict instead of a second workspace.
-- Existing workspaces keep null, which is correct — they were not provisioned, and their owners
-- already hold a membership, so provisioning never considers them.
--
-- `storage_used_bytes` is a cache recomputed wholesale from `storage_objects`, never incremented.
--
-- `ALTER TYPE ... ADD VALUE` cannot be used in the transaction that adds it; nothing writes
-- `workspace.created` until this has committed.

ALTER TYPE "public"."audit_action" ADD VALUE 'workspace.created' BEFORE 'workspace.settings_changed';--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "provisioned_for_user_id" varchar(26);--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "storage_used_bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "storage_usage_refreshed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_provisioned_for_user_id_users_id_fk" FOREIGN KEY ("provisioned_for_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_provisioned_for_user_id_key" ON "workspaces" USING btree ("provisioned_for_user_id");