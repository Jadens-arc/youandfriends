ALTER TABLE "folders" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "deleted_by" varchar(26);--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "purge_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "deleted_batch" varchar(26);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "deleted_by" varchar(26);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "purge_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "deleted_batch" varchar(26);--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "deleted_by" varchar(26);--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "purge_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "deleted_batch" varchar(26);--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "songs" ADD CONSTRAINT "songs_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "folders_workspace_live_idx" ON "folders" USING btree ("workspace_id","parent_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "projects_workspace_live_idx" ON "projects" USING btree ("workspace_id","folder_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "songs_workspace_live_idx" ON "songs" USING btree ("workspace_id","project_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "songs_purge_after_idx" ON "songs" USING btree ("purge_after") WHERE deleted_at is not null;