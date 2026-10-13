-- Task `094`: mentions as structured references, and reactions from a fixed set.
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
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_reactions_emoji_known" CHECK (emoji in ('👍', '❤️', '🔥', '😂', '🎵', '👀'))
);
--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comment_mentions_comment_user_key" ON "comment_mentions" USING btree ("comment_id","user_id");--> statement-breakpoint
CREATE INDEX "comment_mentions_user_idx" ON "comment_mentions" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comment_reactions_comment_user_emoji_key" ON "comment_reactions" USING btree ("comment_id","user_id","emoji");--> statement-breakpoint
CREATE INDEX "comment_reactions_comment_idx" ON "comment_reactions" USING btree ("workspace_id","comment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comments_id_workspace_key" ON "comments" USING btree ("id","workspace_id");--> statement-breakpoint

-- A mention or a reaction belongs to a comment in its own workspace, and goes with it.
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_comment_same_workspace"
  FOREIGN KEY ("comment_id", "workspace_id")
  REFERENCES "public"."comments"("id", "workspace_id")
  ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_comment_same_workspace"
  FOREIGN KEY ("comment_id", "workspace_id")
  REFERENCES "public"."comments"("id", "workspace_id")
  ON DELETE CASCADE;
