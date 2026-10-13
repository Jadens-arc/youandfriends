-- Task `095`: the in-app notification center. Grouped while unread; filtered by access on read.
CREATE TABLE "notifications" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"recipient_id" varchar(26) NOT NULL,
	"event" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" varchar(26) NOT NULL,
	"group_key" text NOT NULL,
	"actor_id" varchar(26),
	"count" integer DEFAULT 1 NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_count_positive" CHECK (count >= 1),
	CONSTRAINT "notifications_target_type_known" CHECK (target_type in ('song', 'project', 'workspace'))
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("workspace_id","recipient_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_unread_group_key" ON "notifications" USING btree ("workspace_id","recipient_id","group_key") WHERE read_at is null;