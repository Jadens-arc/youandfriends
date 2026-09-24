-- Task `044`: recently viewed and played, per person, per workspace.
--
-- A new table and enum, additive. One row per (person, kind, target), moved forward rather than
-- appended, so it grows with people rather than with clicks; the write path also debounces and
-- caps it.
CREATE TYPE "public"."recent_kind" AS ENUM('viewed', 'played');--> statement-breakpoint
CREATE TABLE "recents" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"user_id" varchar(26) NOT NULL,
	"kind" "recent_kind" NOT NULL,
	"target_type" "favorite_target" NOT NULL,
	"target_id" varchar(26) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recents" ADD CONSTRAINT "recents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recents" ADD CONSTRAINT "recents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recents_unique_key" ON "recents" USING btree ("workspace_id","user_id","kind","target_type","target_id");--> statement-breakpoint
CREATE INDEX "recents_workspace_user_idx" ON "recents" USING btree ("workspace_id","user_id","kind","occurred_at");