CREATE TYPE "public"."favorite_target" AS ENUM('folder', 'project', 'song');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('viewer', 'commenter', 'editor', 'owner');--> statement-breakpoint
CREATE TYPE "public"."work_status" AS ENUM('idea', 'in_progress', 'mixing', 'mastering', 'done', 'archived');--> statement-breakpoint
CREATE TABLE "favorites" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"user_id" varchar(26) NOT NULL,
	"target_type" "favorite_target" NOT NULL,
	"target_id" varchar(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"parent_id" varchar(26),
	"name" text NOT NULL,
	"path" text DEFAULT '' NOT NULL,
	"depth" integer GENERATED ALWAYS AS ((length(path) - length(replace(path, '/', ''))) - 2) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"folder_id" varchar(26),
	"name" text NOT NULL,
	"artist" text,
	"cover_asset_id" varchar(26),
	"status" "work_status" DEFAULT 'idea' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "songs" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"project_id" varchar(26) NOT NULL,
	"title" text NOT NULL,
	"duration_ms" integer,
	"status" "work_status" DEFAULT 'idea' NOT NULL,
	"current_version_id" varchar(26),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"clerk_user_id" varchar(255) NOT NULL,
	"email" varchar(320) NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_memberships" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"user_id" varchar(26) NOT NULL,
	"role" "role" NOT NULL,
	"can_download" boolean DEFAULT true NOT NULL,
	"can_invite" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" varchar(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_id_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "songs" ADD CONSTRAINT "songs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "songs" ADD CONSTRAINT "songs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "favorites_unique_key" ON "favorites" USING btree ("workspace_id","user_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "favorites_workspace_user_idx" ON "favorites" USING btree ("workspace_id","user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "folders_parent_name_key" ON "folders" USING btree ("workspace_id","parent_id","name") WHERE parent_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "folders_root_name_key" ON "folders" USING btree ("workspace_id","name") WHERE parent_id is null;--> statement-breakpoint
CREATE INDEX "folders_workspace_path_idx" ON "folders" USING btree ("workspace_id",path text_pattern_ops);--> statement-breakpoint
CREATE INDEX "folders_workspace_parent_idx" ON "folders" USING btree ("workspace_id","parent_id");--> statement-breakpoint
CREATE INDEX "projects_workspace_folder_idx" ON "projects" USING btree ("workspace_id","folder_id");--> statement-breakpoint
CREATE INDEX "projects_workspace_status_idx" ON "projects" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "projects_workspace_updated_idx" ON "projects" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "songs_workspace_project_idx" ON "songs" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE INDEX "songs_workspace_status_idx" ON "songs" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "songs_workspace_updated_idx" ON "songs" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_clerk_user_id_key" ON "users" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_memberships_workspace_user_key" ON "workspace_memberships" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_memberships_workspace_role_idx" ON "workspace_memberships" USING btree ("workspace_id","role");--> statement-breakpoint
CREATE INDEX "workspace_memberships_user_idx" ON "workspace_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspaces_owner_user_id_idx" ON "workspaces" USING btree ("owner_user_id");--> statement-breakpoint
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Everything below this line is hand-written and is part of the tables' contract, not an
-- optimisation applied to them. `drizzle-kit` generates DDL for columns, constraints, and
-- indexes; triggers it neither generates nor diffs, so they live here and are documented in
-- `packages/db/src/schema/folders.ts`.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- `updated_at` is maintained by the database, not by application code. A row touched through
-- `psql` during an incident still gets an honest timestamp, and no caller can forget.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER workspaces_set_updated_at BEFORE UPDATE ON "workspaces"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER workspace_memberships_set_updated_at BEFORE UPDATE ON "workspace_memberships"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER folders_set_updated_at BEFORE UPDATE ON "folders"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER projects_set_updated_at BEFORE UPDATE ON "projects"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER songs_set_updated_at BEFORE UPDATE ON "songs"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- Folder path maintenance and cycle prevention.
--
-- `path` is COMPUTED here rather than supplied by the caller, so it cannot be set wrong: a
-- path that disagrees with `parent_id` would make subtree queries — and therefore permission
-- resolution in task `022` — return the wrong rows, silently.
--
-- Three invariants, all enforced in the database because application-only checks lose races:
--   1. A folder's parent is in the same workspace.
--   2. A folder is never its own ancestor.
--   3. `path` always equals the parent's path with this folder's id appended.
CREATE OR REPLACE FUNCTION folders_before_write() RETURNS trigger AS $$
DECLARE
  parent_path text;
  parent_workspace varchar(26);
BEGIN
  -- Only on insert, or when the parent actually changes. The subtree cascade below updates
  -- `path` directly on descendants whose `parent_id` is unchanged; recomputing there would
  -- read a parent that may not have been updated yet within the same statement.
  IF TG_OP = 'UPDATE' AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_id IS NULL THEN
    NEW.path := '/' || NEW.id || '/';
    RETURN NEW;
  END IF;

  -- Serialise folder moves within a workspace. Without this, two concurrent transactions
  -- moving A under B and B under A each see a pre-move tree, each pass the cycle check, and
  -- commit a cycle that no single transaction could have created. Moves are rare; a
  -- workspace-scoped lock for the duration of one is the right trade.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.workspace_id, 0));

  SELECT path, workspace_id INTO parent_path, parent_workspace
    FROM folders WHERE id = NEW.parent_id;

  IF parent_path IS NULL THEN
    RAISE EXCEPTION 'folder parent % does not exist', NEW.parent_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- A parent in another workspace would put one tenant's folder inside another's tree, which
  -- is the tenant boundary failing at its most literal (THREAT_MODEL T1).
  IF parent_workspace <> NEW.workspace_id THEN
    RAISE EXCEPTION 'folder parent % belongs to another workspace', NEW.parent_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- The parent's path contains every one of its ancestors. If this folder is among them,
  -- the move would close a loop.
  IF position('/' || NEW.id || '/' in parent_path) > 0 THEN
    RAISE EXCEPTION 'folder % cannot be nested under its own descendant %', NEW.id, NEW.parent_id
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.path := parent_path || NEW.id || '/';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER folders_before_write BEFORE INSERT OR UPDATE ON "folders"
  FOR EACH ROW EXECUTE FUNCTION folders_before_write();--> statement-breakpoint

-- Moving a folder moves everything under it. This runs inside the caller's transaction, so
-- the subtree is never half-moved — there is no window in which a descendant's path points
-- at an ancestor chain that no longer exists.
CREATE OR REPLACE FUNCTION folders_after_move() RETURNS trigger AS $$
BEGIN
  IF NEW.path IS DISTINCT FROM OLD.path THEN
    UPDATE folders
       SET path = NEW.path || substring(path FROM length(OLD.path) + 1)
     WHERE workspace_id = NEW.workspace_id
       AND path LIKE OLD.path || '%'
       AND id <> NEW.id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- `WHEN (parent_id changed)` is load-bearing: the cascade's own UPDATE would otherwise
-- re-enter this trigger once per descendant, each re-scanning the same subtree.
CREATE TRIGGER folders_after_move AFTER UPDATE ON "folders"
  FOR EACH ROW WHEN (OLD.parent_id IS DISTINCT FROM NEW.parent_id)
  EXECUTE FUNCTION folders_after_move();
