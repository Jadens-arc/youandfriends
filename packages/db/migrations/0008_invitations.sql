-- ── Invitations, and a nullable workspace-membership baseline (task `032`) ─────────────────
--
-- Additive, plus one widened constraint. Three new `audit_action` values and one new
-- `audit_target_type` value cannot be used in the transaction that adds them, which is fine —
-- nothing writes them until this has committed.
--
-- `workspace_memberships.role` drops NOT NULL. Every existing row keeps its role; nothing
-- reads a null role differently until `packages/authz/src/authorizer.ts`'s `loadMembership`
-- treats one as "no workspace-wide baseline" — the state a collaborator invited to one song
-- needs, so that existing merely as a member does not leak viewer access to the rest of the
-- library (`docs/DESIGN.md` §3: "exactly the folder, project, or song intended — and no
-- further"). See ADR 0010.
CREATE TYPE "public"."invitation_state" AS ENUM('pending', 'accepted', 'revoked');--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'invitation.created' BEFORE 'member.added';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'invitation.accepted' BEFORE 'member.added';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'invitation.revoked' BEFORE 'member.added';--> statement-breakpoint
ALTER TYPE "public"."audit_target_type" ADD VALUE 'invitation' BEFORE 'share_link';--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"email" varchar(320) NOT NULL,
	"scope_type" "grant_scope" NOT NULL,
	"scope_id" varchar(26) NOT NULL,
	"role" "role" NOT NULL,
	"can_download" boolean DEFAULT false NOT NULL,
	"can_invite" boolean DEFAULT false NOT NULL,
	"token_hash" text NOT NULL,
	"state" "invitation_state" DEFAULT 'pending' NOT NULL,
	"invited_by_user_id" varchar(26) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" varchar(26),
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" varchar(26),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_role_not_owner" CHECK (role <> 'owner'),
	CONSTRAINT "invitations_expiry_after_creation" CHECK (expires_at > created_at)
);
--> statement-breakpoint
ALTER TABLE "workspace_memberships" ALTER COLUMN "role" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitations_workspace_state_idx" ON "invitations" USING btree ("workspace_id","state");--> statement-breakpoint
CREATE INDEX "invitations_workspace_email_idx" ON "invitations" USING btree ("workspace_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_pending_email_scope_key" ON "invitations" USING btree ("workspace_id","email","scope_type","scope_id") WHERE state = 'pending';