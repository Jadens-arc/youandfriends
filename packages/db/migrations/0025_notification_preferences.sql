-- Task `096`: notification preferences and email delivery state. Preferences are a person's
-- own, across workspaces; a missing row is the default.
CREATE TABLE "notification_preferences" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"user_id" varchar(26) NOT NULL,
	"event" text NOT NULL,
	"channel" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_channel_known" CHECK (channel in ('in_app', 'email'))
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"user_id" varchar(26) PRIMARY KEY NOT NULL,
	"email_mode" text DEFAULT 'immediate' NOT NULL,
	"last_digest_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_settings_mode_known" CHECK (email_mode in ('immediate', 'daily'))
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "in_app" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "email_status" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "emailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_key" ON "notification_preferences" USING btree ("user_id","event","channel");--> statement-breakpoint
CREATE INDEX "notifications_email_pending_idx" ON "notifications" USING btree ("recipient_id","created_at") WHERE email_status = 'pending';--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_email_status_known" CHECK (email_status is null or email_status in ('pending', 'sent', 'skipped'));