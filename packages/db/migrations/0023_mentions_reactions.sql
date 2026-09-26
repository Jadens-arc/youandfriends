-- Task `094`: mentions and reactions. Both belong to a comment (composite with the workspace,
-- cascading: a purged conversation takes them with it) and to a member of that workspace
-- (composite with the membership, cascading: nobody outside the workspace can be mentioned or
-- react, and removing someone removes theirs).
CREATE TABLE "comment_mentions" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"comment_id" varchar(26) NOT NULL,
	"user_id" varchar(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment_reactions" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"comment_id" varchar(26) NOT NULL,
	"user_id" varchar(26) NOT NULL,
	"reaction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_reactions_known" CHECK (reaction in ('thumbs_up', 'heart', 'fire', 'laugh', 'party', 'eyes'))
);
--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comment_mentions_comment_user_key" ON "comment_mentions" USING btree ("comment_id","user_id");--> statement-breakpoint
CREATE INDEX "comment_mentions_user_idx" ON "comment_mentions" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comment_reactions_once_key" ON "comment_reactions" USING btree ("comment_id","user_id","reaction");--> statement-breakpoint
CREATE INDEX "comment_reactions_comment_idx" ON "comment_reactions" USING btree ("workspace_id","comment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comments_id_workspace_key" ON "comments" USING btree ("id","workspace_id");--> statement-breakpoint

ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_comment_same_workspace"
  FOREIGN KEY ("comment_id", "workspace_id")
  REFERENCES "public"."comments"("id", "workspace_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_member_of_workspace"
  FOREIGN KEY ("workspace_id", "user_id")
  REFERENCES "public"."workspace_memberships"("workspace_id", "user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_comment_same_workspace"
  FOREIGN KEY ("comment_id", "workspace_id")
  REFERENCES "public"."comments"("id", "workspace_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_member_of_workspace"
  FOREIGN KEY ("workspace_id", "user_id")
  REFERENCES "public"."workspace_memberships"("workspace_id", "user_id") ON DELETE CASCADE;
