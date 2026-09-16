CREATE TYPE "public"."grant_scope" AS ENUM('folder', 'project', 'song');--> statement-breakpoint
CREATE TYPE "public"."subject_kind" AS ENUM('member', 'sync_token', 'share_link', 'anonymous');--> statement-breakpoint
CREATE TABLE "permission_grants" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"scope_type" "grant_scope" NOT NULL,
	"scope_id" varchar(26) NOT NULL,
	"subject_kind" "subject_kind" NOT NULL,
	"subject_id" varchar(26) NOT NULL,
	"role" "role",
	"can_download" boolean,
	"can_invite" boolean,
	"is_deny" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_by_user_id" varchar(26),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permission_grants_states_something" CHECK (is_deny or role is not null),
	CONSTRAINT "permission_grants_window_ordered" CHECK (starts_at is null or ends_at is null or starts_at < ends_at)
);
--> statement-breakpoint
ALTER TABLE "permission_grants" ADD CONSTRAINT "permission_grants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_grants" ADD CONSTRAINT "permission_grants_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "permission_grants_scope_subject_key" ON "permission_grants" USING btree ("workspace_id","scope_type","scope_id","subject_kind","subject_id");--> statement-breakpoint
CREATE INDEX "permission_grants_subject_idx" ON "permission_grants" USING btree ("workspace_id","subject_kind","subject_id");--> statement-breakpoint
CREATE INDEX "permission_grants_scope_idx" ON "permission_grants" USING btree ("workspace_id","scope_type","scope_id");--> statement-breakpoint
CREATE TRIGGER permission_grants_set_updated_at BEFORE UPDATE ON "permission_grants"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
