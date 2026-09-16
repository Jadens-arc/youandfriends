CREATE TYPE "public"."asset_kind" AS ENUM('master', 'mix', 'stem', 'sample', 'project_file', 'artwork', 'voice_note');--> statement-breakpoint
CREATE TYPE "public"."snapshot_source" AS ENUM('browser_folder', 'mac_agent');--> statement-breakpoint
CREATE TYPE "public"."derivative_kind" AS ENUM('streaming_audio', 'waveform_peaks', 'thumbnail');--> statement-breakpoint
CREATE TYPE "public"."processing_state" AS ENUM('queued', 'running', 'complete', 'failed');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"song_id" varchar(26),
	"project_id" varchar(26),
	"kind" "asset_kind" NOT NULL,
	"name" text NOT NULL,
	"folder_path" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" varchar(26),
	"purge_after" timestamp with time zone,
	"deleted_batch" varchar(26),
	CONSTRAINT "assets_one_owner" CHECK (num_nonnulls(song_id, project_id) = 1),
	CONSTRAINT "assets_folder_path_normalized" CHECK (folder_path = ''
        or (length(folder_path) <= 1024
            and folder_path = normalize(folder_path, NFC)
            and folder_path ~ '^/([ -~]+/)*$'
            and folder_path !~ '(^|/)[[:space:]]*\.\.[[:space:]]*(/|$)'
            and folder_path !~ '(^|/)[[:space:]]*\.[[:space:]]*(/|$)'
            and folder_path !~ '(^|/)[[:space:]]'
            and folder_path !~ '[[:space:]](/|$)'
            and folder_path !~ '%[0-9A-Fa-f][0-9A-Fa-f]'))
);
--> statement-breakpoint
CREATE TABLE "snapshot_entries" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"snapshot_id" varchar(26) NOT NULL,
	"relative_path" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"modified_at" timestamp with time zone,
	"checksum_sha256" varchar(64),
	"ignored" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_entries_relative_path_safe" CHECK (relative_path <> ''
        and length(relative_path) <= 1024
        and relative_path = normalize(relative_path, NFC)
        and relative_path ~ '^[ -~]+$'
        and relative_path !~ '^/'
        and relative_path !~ '^[A-Za-z]:'
        and relative_path !~ '\\'
        and relative_path !~ '(^|/)[[:space:]]*\.\.[[:space:]]*(/|$)'
        and relative_path !~ '(^|/)[[:space:]]*\.[[:space:]]*(/|$)'
        and relative_path !~ '(^|/)[[:space:]]'
        and relative_path !~ '[[:space:]](/|$)'
        and relative_path !~ '//'
        and relative_path !~ '/$'
        and relative_path !~ '%[0-9A-Fa-f][0-9A-Fa-f]'
        and relative_path !~ '(^|/)~'),
	CONSTRAINT "snapshot_entries_size_non_negative" CHECK (size_bytes >= 0)
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"project_id" varchar(26) NOT NULL,
	"source" "snapshot_source" NOT NULL,
	"name" text NOT NULL,
	"storage_object_id" varchar(26),
	"finalized_at" timestamp with time zone,
	"created_by" varchar(26),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" varchar(26),
	"purge_after" timestamp with time zone,
	"deleted_batch" varchar(26)
);
--> statement-breakpoint
CREATE TABLE "storage_objects" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"bucket" varchar(128) NOT NULL,
	"key" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum_sha256" varchar(64) NOT NULL,
	"content_type" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_versions" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"asset_id" varchar(26) NOT NULL,
	"version_number" integer NOT NULL,
	"storage_object_id" varchar(26) NOT NULL,
	"uploaded_by" varchar(26),
	"note" text,
	"duration_ms" integer,
	"codec" text,
	"channels" integer,
	"sample_rate_hz" integer,
	"bit_depth" integer,
	"integrated_lufs" real,
	"true_peak_db" real,
	"processing_state" "processing_state" DEFAULT 'queued' NOT NULL,
	"processing_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_versions_number_positive" CHECK (version_number >= 1)
);
--> statement-breakpoint
CREATE TABLE "derivatives" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"asset_version_id" varchar(26) NOT NULL,
	"kind" "derivative_kind" NOT NULL,
	"variant" text DEFAULT 'default' NOT NULL,
	"storage_object_id" varchar(26),
	"processing_state" "processing_state" DEFAULT 'queued' NOT NULL,
	"processing_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mix_versions" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(26) NOT NULL,
	"song_id" varchar(26) NOT NULL,
	"version_number" integer NOT NULL,
	"asset_version_id" varchar(26) NOT NULL,
	"uploaded_by" varchar(26),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mix_versions_number_positive" CHECK (version_number >= 1)
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_entries" ADD CONSTRAINT "snapshot_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_entries" ADD CONSTRAINT "snapshot_entries_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_storage_object_id_storage_objects_id_fk" FOREIGN KEY ("storage_object_id") REFERENCES "public"."storage_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD CONSTRAINT "storage_objects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_storage_object_id_storage_objects_id_fk" FOREIGN KEY ("storage_object_id") REFERENCES "public"."storage_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derivatives" ADD CONSTRAINT "derivatives_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derivatives" ADD CONSTRAINT "derivatives_asset_version_id_asset_versions_id_fk" FOREIGN KEY ("asset_version_id") REFERENCES "public"."asset_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "derivatives" ADD CONSTRAINT "derivatives_storage_object_id_storage_objects_id_fk" FOREIGN KEY ("storage_object_id") REFERENCES "public"."storage_objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mix_versions" ADD CONSTRAINT "mix_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mix_versions" ADD CONSTRAINT "mix_versions_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mix_versions" ADD CONSTRAINT "mix_versions_asset_version_id_asset_versions_id_fk" FOREIGN KEY ("asset_version_id") REFERENCES "public"."asset_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assets_id_workspace_key" ON "assets" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE INDEX "assets_workspace_song_idx" ON "assets" USING btree ("workspace_id","song_id");--> statement-breakpoint
CREATE INDEX "assets_workspace_project_idx" ON "assets" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE INDEX "assets_workspace_kind_idx" ON "assets" USING btree ("workspace_id","kind");--> statement-breakpoint
CREATE INDEX "assets_workspace_live_idx" ON "assets" USING btree ("workspace_id","song_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_entries_path_key" ON "snapshot_entries" USING btree ("workspace_id","snapshot_id","relative_path");--> statement-breakpoint
CREATE INDEX "snapshot_entries_snapshot_idx" ON "snapshot_entries" USING btree ("workspace_id","snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshots_id_workspace_key" ON "snapshots" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE INDEX "snapshots_workspace_project_idx" ON "snapshots" USING btree ("workspace_id","project_id","created_at");--> statement-breakpoint
CREATE INDEX "snapshots_workspace_live_idx" ON "snapshots" USING btree ("workspace_id","project_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "storage_objects_bucket_key_key" ON "storage_objects" USING btree ("bucket","key");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_objects_id_workspace_key" ON "storage_objects" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE INDEX "storage_objects_workspace_idx" ON "storage_objects" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "storage_objects_checksum_idx" ON "storage_objects" USING btree ("workspace_id","checksum_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_versions_asset_number_key" ON "asset_versions" USING btree ("workspace_id","asset_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_versions_id_workspace_key" ON "asset_versions" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE INDEX "asset_versions_workspace_asset_idx" ON "asset_versions" USING btree ("workspace_id","asset_id");--> statement-breakpoint
CREATE INDEX "asset_versions_storage_object_idx" ON "asset_versions" USING btree ("storage_object_id");--> statement-breakpoint
CREATE INDEX "asset_versions_processing_idx" ON "asset_versions" USING btree ("workspace_id","processing_state") WHERE processing_state <> 'complete';--> statement-breakpoint
CREATE UNIQUE INDEX "derivatives_version_kind_variant_key" ON "derivatives" USING btree ("workspace_id","asset_version_id","kind","variant");--> statement-breakpoint
CREATE INDEX "derivatives_workspace_version_idx" ON "derivatives" USING btree ("workspace_id","asset_version_id");--> statement-breakpoint
CREATE INDEX "derivatives_processing_idx" ON "derivatives" USING btree ("workspace_id","processing_state") WHERE processing_state <> 'complete';--> statement-breakpoint
CREATE UNIQUE INDEX "mix_versions_song_number_key" ON "mix_versions" USING btree ("workspace_id","song_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "mix_versions_id_song_key" ON "mix_versions" USING btree ("id","song_id");--> statement-breakpoint
CREATE INDEX "mix_versions_workspace_song_idx" ON "mix_versions" USING btree ("workspace_id","song_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_id_workspace_key" ON "projects" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "songs_id_workspace_key" ON "songs" USING btree ("id","workspace_id");--> statement-breakpoint
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Hand-written DDL. `drizzle-kit` generates columns, constraints, and indexes; the rest of
-- this file is part of the tables' contract rather than an optimisation applied to them.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- The forward reference task `021` deliberately left open.
--
-- A plain `current_version_id -> mix_versions.id` would let a song point at another song's
-- version. The *pair* makes "a song's current version is a version of that song" something
-- the database enforces, not an invariant the application maintains. It cannot be expressed
-- in the schema module without a circular import, so it lives here.
ALTER TABLE "songs" ADD CONSTRAINT "songs_current_version_belongs_to_song"
  FOREIGN KEY ("current_version_id", "id")
  REFERENCES "mix_versions" ("id", "song_id")
  -- The column list is load-bearing. A bare `ON DELETE SET NULL` nulls *every* referencing
  -- column, and the referencing pair here is `(current_version_id, id)` — so deleting the
  -- current mix tries to null `songs.id` and fails with a not-null violation that names the
  -- wrong problem entirely. Naming the column confines it to the pointer.
  ON DELETE SET NULL ("current_version_id")
  DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint

CREATE TRIGGER assets_set_updated_at BEFORE UPDATE ON "assets"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER snapshots_set_updated_at BEFORE UPDATE ON "snapshots"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

-- ── Originals are sacred ──────────────────────────────────────────────────────────────────
--
-- "A new upload always creates a version, never an overwrite" (`docs/THREAT_MODEL.md` T8) is
-- a schema property here, not a code convention. The trigger rejects any change to the
-- columns that identify *which bytes these are*.
--
-- The analysis columns are deliberately excluded. `duration_ms`, `codec`, loudness and the
-- rest are things we learned *about* the bytes: an ffprobe pass that failed and was retried
-- has to be able to write its answer, and a better loudness algorithm has to be able to
-- re-run over old files. What must never change is the bytes and what points at them.
CREATE OR REPLACE FUNCTION asset_versions_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.asset_id IS DISTINCT FROM OLD.asset_id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.version_number IS DISTINCT FROM OLD.version_number
     OR NEW.storage_object_id IS DISTINCT FROM OLD.storage_object_id
     OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'asset_versions are immutable: % cannot be changed after upload',
      CASE
        WHEN NEW.storage_object_id IS DISTINCT FROM OLD.storage_object_id THEN 'storage_object_id'
        WHEN NEW.asset_id IS DISTINCT FROM OLD.asset_id THEN 'asset_id'
        WHEN NEW.version_number IS DISTINCT FROM OLD.version_number THEN 'version_number'
        WHEN NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN 'workspace_id'
        WHEN NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by THEN 'uploaded_by'
        ELSE 'created_at'
      END
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Upload a new version instead. Originals are never overwritten.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER asset_versions_immutable BEFORE UPDATE ON "asset_versions"
  FOR EACH ROW EXECUTE FUNCTION asset_versions_immutable();--> statement-breakpoint

-- A storage object's bytes are identified by its checksum and size. Changing either would
-- mean the row no longer describes the object it names, and reconciliation would compare
-- against a fiction.
CREATE OR REPLACE FUNCTION storage_objects_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.bucket IS DISTINCT FROM OLD.bucket
     OR NEW.key IS DISTINCT FROM OLD.key
     OR NEW.checksum_sha256 IS DISTINCT FROM OLD.checksum_sha256
     OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
  THEN
    RAISE EXCEPTION 'storage_objects are immutable: bucket, key, checksum, and size cannot change'
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Record a new storage object instead.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER storage_objects_immutable BEFORE UPDATE ON "storage_objects"
  FOR EACH ROW EXECUTE FUNCTION storage_objects_immutable();--> statement-breakpoint

-- ── A finalized snapshot is sealed ────────────────────────────────────────────────────────
--
-- A snapshot says what a folder looked like at one moment. One that can be edited afterwards
-- records what someone later wished had been there, which is a different and much less useful
-- thing. Only the soft-delete columns may change after finalization — trashing a snapshot is
-- not editing it.
CREATE OR REPLACE FUNCTION snapshots_sealed_when_finalized() RETURNS trigger AS $$
BEGIN
  IF OLD.finalized_at IS NOT NULL
     AND (NEW.name IS DISTINCT FROM OLD.name
          OR NEW.source IS DISTINCT FROM OLD.source
          OR NEW.project_id IS DISTINCT FROM OLD.project_id
          OR NEW.storage_object_id IS DISTINCT FROM OLD.storage_object_id
          OR NEW.finalized_at IS DISTINCT FROM OLD.finalized_at)
  THEN
    RAISE EXCEPTION 'snapshot % is finalized and cannot be changed', OLD.id
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Capture a new snapshot instead.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER snapshots_sealed BEFORE UPDATE ON "snapshots"
  FOR EACH ROW EXECUTE FUNCTION snapshots_sealed_when_finalized();--> statement-breakpoint

-- Entries describe the sealed contents, so they are sealed with it.
CREATE OR REPLACE FUNCTION snapshot_entries_sealed() RETURNS trigger AS $$
DECLARE
  finalized timestamptz;
BEGIN
  SELECT finalized_at INTO finalized FROM snapshots
   WHERE id = COALESCE(NEW.snapshot_id, OLD.snapshot_id);

  IF finalized IS NOT NULL THEN
    RAISE EXCEPTION 'snapshot % is finalized: its entries cannot be % ',
      COALESCE(NEW.snapshot_id, OLD.snapshot_id), lower(TG_OP)
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER snapshot_entries_sealed BEFORE INSERT OR UPDATE OR DELETE ON "snapshot_entries"
  FOR EACH ROW EXECUTE FUNCTION snapshot_entries_sealed();--> statement-breakpoint

-- ── The newest mix becomes current ────────────────────────────────────────────────────────
--
-- `docs/DESIGN.md` §2: "the latest upload becomes current automatically while all earlier
-- versions remain available". Doing it here rather than in the upload path means every writer
-- gets it — the browser upload, the Mac agent, a future import — and none of them can forget.
CREATE OR REPLACE FUNCTION mix_versions_become_current() RETURNS trigger AS $$
BEGIN
  UPDATE songs
     SET current_version_id = NEW.id
   WHERE id = NEW.song_id
     AND workspace_id = NEW.workspace_id
     AND (current_version_id IS NULL
          OR (SELECT version_number FROM mix_versions WHERE id = songs.current_version_id)
              < NEW.version_number);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- Only forward. Back-filling an older version — a repair, an import out of order — must not
-- silently move the pointer backwards past a newer mix someone is already listening to.
CREATE TRIGGER mix_versions_become_current AFTER INSERT ON "mix_versions"
  FOR EACH ROW EXECUTE FUNCTION mix_versions_become_current();
--> statement-breakpoint
-- ── A parent is always in the same workspace ──────────────────────────────────────────────
--
-- A plain `assets.song_id -> songs.id` says nothing about tenancy: a row could carry
-- `workspace_id = A` while pointing at a song in workspace B. Nothing in the product would
-- write that, but "nothing would write that" is a claim about code, and `docs/THREAT_MODEL.md`
-- T1 asks for a claim about the database. Task `021` made the same guarantee for folder
-- parents with a trigger; these are the declarative version of it.
--
-- Each pair references the `(id, workspace_id)` unique key on the parent, so the workspace
-- travels with the reference and Postgres checks both together.
ALTER TABLE "assets" ADD CONSTRAINT "assets_song_same_workspace"
  FOREIGN KEY ("song_id", "workspace_id") REFERENCES "songs" ("id", "workspace_id")
  ON DELETE CASCADE;--> statement-breakpoint

ALTER TABLE "assets" ADD CONSTRAINT "assets_project_same_workspace"
  FOREIGN KEY ("project_id", "workspace_id") REFERENCES "projects" ("id", "workspace_id")
  ON DELETE CASCADE;--> statement-breakpoint

ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_asset_same_workspace"
  FOREIGN KEY ("asset_id", "workspace_id") REFERENCES "assets" ("id", "workspace_id")
  ON DELETE CASCADE;--> statement-breakpoint

ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_object_same_workspace"
  FOREIGN KEY ("storage_object_id", "workspace_id")
  REFERENCES "storage_objects" ("id", "workspace_id")
  ON DELETE RESTRICT;--> statement-breakpoint

ALTER TABLE "mix_versions" ADD CONSTRAINT "mix_versions_song_same_workspace"
  FOREIGN KEY ("song_id", "workspace_id") REFERENCES "songs" ("id", "workspace_id")
  ON DELETE CASCADE;--> statement-breakpoint

ALTER TABLE "mix_versions" ADD CONSTRAINT "mix_versions_version_same_workspace"
  FOREIGN KEY ("asset_version_id", "workspace_id")
  REFERENCES "asset_versions" ("id", "workspace_id")
  ON DELETE RESTRICT;--> statement-breakpoint

ALTER TABLE "derivatives" ADD CONSTRAINT "derivatives_version_same_workspace"
  FOREIGN KEY ("asset_version_id", "workspace_id")
  REFERENCES "asset_versions" ("id", "workspace_id")
  ON DELETE CASCADE;--> statement-breakpoint

ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_project_same_workspace"
  FOREIGN KEY ("project_id", "workspace_id") REFERENCES "projects" ("id", "workspace_id")
  ON DELETE CASCADE;--> statement-breakpoint

ALTER TABLE "snapshot_entries" ADD CONSTRAINT "snapshot_entries_snapshot_same_workspace"
  FOREIGN KEY ("snapshot_id", "workspace_id") REFERENCES "snapshots" ("id", "workspace_id")
  ON DELETE CASCADE;--> statement-breakpoint

-- Three tables reference `storage_objects`, and the first pass paired only one of them. A
-- derivative or a snapshot in workspace A pointing at B's object is a row that reads as A's
-- through a scoped handle — so a stream or download endpoint resolves it, presigns B's key,
-- and hands A someone else's music. The `asset_versions` pair alone made the class *look*
-- closed, which is worse than not having started.
ALTER TABLE "derivatives" ADD CONSTRAINT "derivatives_object_same_workspace"
  FOREIGN KEY ("storage_object_id", "workspace_id")
  REFERENCES "storage_objects" ("id", "workspace_id")
  ON DELETE SET NULL ("storage_object_id");--> statement-breakpoint

ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_object_same_workspace"
  FOREIGN KEY ("storage_object_id", "workspace_id")
  REFERENCES "storage_objects" ("id", "workspace_id")
  ON DELETE RESTRICT;
