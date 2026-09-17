import { deterministicId } from './ids';

/**
 * What the seeded workspace contains.
 *
 * Declarative, so the shape is readable in one place and the writer below is mechanical.
 *
 * **The awkward cases are here on purpose.** A seed of happy paths hides exactly the layouts
 * that break: a title too long for its column, a project with no cover art, a version whose
 * media job failed, a folder with nothing in it. Task `027`'s notes call for them, and they
 * are the reason to look at seeded data at all.
 */

export const SEED_WORKSPACE_ID = deterministicId('workspace');

export interface SeedUser {
  readonly key: string;
  readonly displayName: string;
  readonly email: string;
  readonly role: 'owner' | 'editor' | 'commenter' | 'viewer';
  readonly canDownload: boolean;
  readonly canInvite: boolean;
}

/**
 * One collaborator at each role, so permission behaviour is visible without setting it up.
 *
 * These are the workspace-wide baselines. `docs/DESIGN.md` §3's independence of download from
 * role shows up in both directions once {@link SEED_GRANTS} is applied on top: Tom is an editor
 * who may **not** download anywhere, and Priya is a viewer who may download inside one project
 * and nowhere else. A seed where download tracked role would make the distinction invisible in
 * every screenshot anyone ever takes.
 */
export const SEED_USERS: readonly SeedUser[] = [
  {
    key: 'avery',
    displayName: 'Avery',
    email: 'avery@example.test',
    role: 'owner',
    canDownload: true,
    canInvite: true,
  },
  {
    key: 'tom',
    displayName: 'Tom Okafor',
    email: 'tom@example.test',
    role: 'editor',
    canDownload: false,
    canInvite: false,
  },
  {
    // Cannot download by default. A grant raises it inside one project, which is the only way
    // to see that capabilities resolve per scope rather than per person.
    key: 'priya',
    displayName: 'Priya Raman',
    email: 'priya@example.test',
    role: 'viewer',
    canDownload: false,
    canInvite: false,
  },
  {
    key: 'sam',
    displayName: 'Sam Beaulieu',
    email: 'sam@example.test',
    role: 'commenter',
    canDownload: false,
    canInvite: false,
  },
];

export interface SeedFolder {
  readonly key: string;
  readonly name: string;
  readonly parentKey?: string;
}

export const SEED_FOLDERS: readonly SeedFolder[] = [
  { key: 'albums', name: 'Albums' },
  { key: 'albums-2026', name: '2026', parentKey: 'albums' },
  { key: 'albums-2026-blue', name: 'Blue Hour', parentKey: 'albums-2026' },
  { key: 'sketches', name: 'Sketches' },
  // Deliberately empty: an empty folder is a state the tree has to render, and nobody
  // creates one by accident while testing.
  { key: 'archive', name: 'Archive' },
];

export interface SeedProject {
  readonly key: string;
  readonly name: string;
  readonly artist: string | null;
  readonly folderKey: string | null;
  readonly status: 'idea' | 'in_progress' | 'mixing' | 'mastering' | 'done' | 'archived';
  readonly hasCoverArt: boolean;
}

export const SEED_PROJECTS: readonly SeedProject[] = [
  {
    key: 'blue-hour',
    name: 'Blue Hour',
    artist: 'Avery and Friends',
    folderKey: 'albums-2026-blue',
    status: 'mixing',
    hasCoverArt: true,
  },
  {
    // No cover art: the fallback is a layout nobody looks at until it is wrong.
    key: 'second-sleep',
    name: 'Second Sleep',
    artist: 'Avery and Friends',
    folderKey: 'albums-2026',
    status: 'in_progress',
    hasCoverArt: false,
  },
  {
    // Unfiled, which is a normal state the library has to show somewhere.
    key: 'loose-ideas',
    name: 'Loose Ideas',
    artist: null,
    folderKey: null,
    status: 'idea',
    hasCoverArt: false,
  },
];

export interface SeedSong {
  readonly key: string;
  readonly title: string;
  readonly projectKey: string;
  readonly status: SeedProject['status'];
  /** How many mix versions to stack under it. */
  readonly versions: number;
  /** When true, the newest version's media job is left failed. */
  readonly failedJob?: boolean;
}

export const SEED_SONGS: readonly SeedSong[] = [
  {
    key: 'blue-hour-1',
    title: 'Blue Hour',
    projectKey: 'blue-hour',
    status: 'mixing',
    versions: 4,
  },
  {
    key: 'blue-hour-2',
    title: 'Careless Weather',
    projectKey: 'blue-hour',
    status: 'mixing',
    versions: 2,
  },
  {
    // The long-title case. Columns, cards, the mini-player's single line, the browser tab —
    // all of them truncate somewhere, and this is where that shows up.
    key: 'blue-hour-3',
    title:
      'A Reasonably Long Song Title That Keeps Going Well Past Where Anyone Designed For It To Stop',
    projectKey: 'blue-hour',
    status: 'in_progress',
    versions: 2,
  },
  {
    // A failed media job: the processing state the UI must show honestly rather than
    // pretending the file is still on its way.
    key: 'second-sleep-1',
    title: 'Second Sleep',
    projectKey: 'second-sleep',
    status: 'in_progress',
    versions: 3,
    failedJob: true,
  },
  {
    key: 'second-sleep-2',
    title: 'Low Tide',
    projectKey: 'second-sleep',
    status: 'idea',
    versions: 1,
  },
  {
    // No versions at all: a song someone made before uploading anything.
    key: 'loose-ideas-1',
    title: 'Untitled Sketch',
    projectKey: 'loose-ideas',
    status: 'idea',
    versions: 0,
  },
];

/**
 * The grants layered on top of the memberships.
 *
 * **Every one of these must differ from the grantee's membership in at least one facet.** A
 * grant that restates the baseline resolves to the same answer as no grant at all, so nothing
 * about inheritance is visible in the seeded workspace and a broken resolver would look
 * correct. The first version of this seed had three such grants; a test below now holds the
 * line.
 */
export interface SeedGrant {
  readonly key: string;
  readonly userKey: string;
  readonly scopeType: 'folder' | 'project' | 'song';
  readonly scopeKey: string;
  readonly role: 'viewer' | 'commenter' | 'editor' | 'owner' | null;
  readonly canDownload?: boolean | null;
  readonly isDeny?: boolean;
  readonly why: string;
}

/**
 * Grants that make the permission rules visible by default.
 *
 * The deny override is the one that matters: Tom is an editor on the Blue Hour folder and
 * denied on one song inside it. Without that row in the seed, nobody sees the rule working
 * until they write a test for it.
 */
export const SEED_GRANTS: readonly SeedGrant[] = [
  {
    key: 'tom-download-inside-blue-hour',
    userKey: 'tom',
    scopeType: 'folder',
    scopeKey: 'albums-2026-blue',
    role: 'editor',
    canDownload: true,
    why: 'Folder-level, inherited downward: Tom may download inside Blue Hour and nowhere else.',
  },
  {
    key: 'tom-denied-on-careless',
    userKey: 'tom',
    scopeType: 'song',
    scopeKey: 'blue-hour-2',
    role: null,
    isDeny: true,
    why: 'Deny override: beats the folder grant above and his membership, on this song only.',
  },
  {
    key: 'priya-download-blue-hour',
    userKey: 'priya',
    scopeType: 'project',
    scopeKey: 'blue-hour',
    role: 'viewer',
    canDownload: true,
    why: 'Capability raised without changing role — download resolves independently.',
  },
  {
    key: 'sam-editor-on-second-sleep',
    userKey: 'sam',
    scopeType: 'song',
    scopeKey: 'second-sleep-1',
    role: 'editor',
    why: 'Song-level elevation: a commenter who edits exactly one song.',
  },
];
