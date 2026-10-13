-- Task `096`: notification preferences, and the email outbox. Emails carry no preview text.
CREATE TABLE "notification_emails" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"recipient_id" varchar(26) NOT NULL,
	"event" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" varchar(26) NOT NULL,
	"actor_id" varchar(26),
	"link" jsonb,
	"mode" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "notification_emails_mode_known" CHECK (mode in ('immediate', 'digest')),
	CONSTRAINT "notification_emails_status_known" CHECK (status in ('queued', 'sent', 'dropped', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"user_id" varchar(26) NOT NULL,
	"event" text NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"email" text DEFAULT 'off' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_email_known" CHECK (email in ('off', 'immediate', 'digest'))
);
--> statement-breakpoint
ALTER TABLE "notification_emails" ADD CONSTRAINT "notification_emails_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_emails" ADD CONSTRAINT "notification_emails_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_emails" ADD CONSTRAINT "notification_emails_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_emails_queue_idx" ON "notification_emails" USING btree ("workspace_id","mode","created_at") WHERE status = 'queued';--> statement-breakpoint
CREATE INDEX "notification_emails_recipient_idx" ON "notification_emails" USING btree ("workspace_id","recipient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_user_event_key" ON "notification_preferences" USING btree ("workspace_id","user_id","event");