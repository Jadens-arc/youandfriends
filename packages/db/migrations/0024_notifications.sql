-- Task `095`: the notification center. One row per recipient per event; content is read from
-- its source when shown, and access is checked again when read.
CREATE TABLE "notifications" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"recipient_id" varchar(26) NOT NULL,
	"actor_id" varchar(26),
	"event" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" varchar(26) NOT NULL,
	"group_key" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_target_known" CHECK (target_type in ('song', 'project', 'workspace', 'invitation')),
	CONSTRAINT "notifications_not_to_self" CHECK (actor_id is null or actor_id <> recipient_id)
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("workspace_id","recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("workspace_id","recipient_id") WHERE read_at is null;--> statement-breakpoint
CREATE INDEX "notifications_invitations_idx" ON "notifications" USING btree ("recipient_id","created_at") WHERE target_type = 'invitation';