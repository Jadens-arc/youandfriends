import { z } from 'zod';

import { projectIdSchema, ulidSchema, uploadSessionIdSchema } from './ids';

/**
 * Folder snapshots (task `054`): the path rule, the ignore rules, and the manifest.
 *
 * Shared by the browser folder upload and the server, and written as *data* where it can be, so
 * the macOS agent (task `113`, in Rust) can be tested against the same cases rather than a
 * re-typed copy that drifts. The golden cases live in `snapshots.cases.json` beside this file.
 */

/** The longest relative path the schema accepts (`snapshot_entries_relative_path_safe`). */
export const MAX_RELATIVE_PATH = 1024;

export type PathRejection =
  'empty' | 'too_long' | 'absolute' | 'traversal' | 'unsupported_characters' | 'reserved_name';

/**
 * Normalize a relative path from a user's filesystem, or say why it cannot be stored.
 *
 * **The same rule as the database's check constraint** on `snapshot_entries.relative_path`
 * (task `026`), which is an allow-list after a security review got past a deny-list seven ways:
 * printable ASCII only, NFC, no backslashes, no `.`/`..` segments, no leading `/`, `~`, or drive
 * letter, no `%XX` escapes, no whitespace at a segment's edges. The client applies it for a
 * readable review; the server applies it again because the client is not a control
 * (`docs/THREAT_MODEL.md` T4); the constraint applies it a third time for any writer that forgets.
 *
 * Normalization is limited to what cannot change meaning: collapsing repeated slashes and
 * trimming a trailing one. Nothing is decoded, case-folded, or transliterated — a path that is
 * not already acceptable is rejected with a reason, never quietly rewritten into a different one.
 */
export function normalizeRelativePath(
  raw: string,
): { ok: true; path: string } | { ok: false; reason: PathRejection } {
  if (raw.trim() === '') return { ok: false, reason: 'empty' };
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw) || raw.startsWith('\\')) {
    return { ok: false, reason: 'absolute' };
  }
  // Checked before the character allow-list so that a traversal is named as one, whatever else
  // is wrong with the string.
  const segments = raw.split(/[/\\]/);
  if (segments.some((segment) => /^\s*\.{1,2}\s*$/.test(segment))) {
    return { ok: false, reason: 'traversal' };
  }
  if (raw.normalize('NFC') !== raw || !/^[ -~]+$/.test(raw) || raw.includes('\\')) {
    return { ok: false, reason: 'unsupported_characters' };
  }
  if (/%[0-9A-Fa-f]{2}/.test(raw)) return { ok: false, reason: 'unsupported_characters' };

  const path = raw.replace(/\/{2,}/g, '/').replace(/\/$/, '');
  const parts = path.split('/');
  if (parts.some((part) => part === '' || /^\s|\s$/.test(part))) {
    return { ok: false, reason: 'unsupported_characters' };
  }
  if (parts.some((part) => part.startsWith('~'))) return { ok: false, reason: 'reserved_name' };
  if (path.length > MAX_RELATIVE_PATH) return { ok: false, reason: 'too_long' };
  return { ok: true, path };
}

export const PATH_REJECTION_REASONS: Readonly<Record<PathRejection, string>> = {
  empty: 'It has no name.',
  too_long: 'Its path is longer than 1,024 characters.',
  absolute: 'It points outside the folder.',
  traversal: 'It points outside the folder.',
  unsupported_characters:
    'Its name uses characters that can’t be stored yet (accents, emoji, and non-Latin scripts).',
  reserved_name: 'Its name starts with “~”, which is reserved.',
};

/**
 * One ignore rule: a pattern over the path's final segment or the whole path, and the sentence
 * a person is shown for it. The review step exists so nobody discovers at the worst moment that
 * their project is incomplete; "ignored" with no reason is the thing it prevents.
 */
export interface IgnoreRule {
  readonly id: string;
  /**
   * A glob: `*` matches within a segment, `**` across segments. Matched against the whole
   * relative path, and — when it contains no `/` — against each segment too, so `.DS_Store`
   * catches one at any depth.
   */
  readonly pattern: string;
  readonly reason: string;
}

/**
 * The defaults (`docs/DESIGN.md` §9): transient and unsafe files. Deliberately short — every
 * pattern here is a file someone might one day want, and a surprising omission is worse than a
 * stray `.DS_Store`.
 */
export const DEFAULT_IGNORE_RULES: readonly IgnoreRule[] = [
  {
    id: 'ds_store',
    pattern: '.DS_Store',
    reason: 'macOS folder settings, not part of the project.',
  },
  { id: 'apple_double', pattern: '._*', reason: 'macOS metadata copy, not part of the project.' },
  { id: 'thumbs', pattern: 'Thumbs.db', reason: 'Windows thumbnail cache.' },
  { id: 'desktop_ini', pattern: 'desktop.ini', reason: 'Windows folder settings.' },
  { id: 'lock', pattern: '*.lock', reason: 'A lock file from an app that had the project open.' },
  {
    id: 'office_lock',
    pattern: '~$*',
    reason: 'A lock file from an app that had the project open.',
  },
  { id: 'tmp', pattern: '*.tmp', reason: 'A temporary file.' },
  { id: 'partial', pattern: '*.part', reason: 'An incomplete download or render.' },
  { id: 'crdownload', pattern: '*.crdownload', reason: 'An incomplete download.' },
  { id: 'caches', pattern: '.cache', reason: 'A hidden cache folder.' },
  { id: 'fseventsd', pattern: '.fseventsd', reason: 'macOS file-system bookkeeping.' },
  { id: 'spotlight', pattern: '.Spotlight-V100', reason: 'macOS search index.' },
  { id: 'trashes', pattern: '.Trashes', reason: 'A deleted-files folder.' },
];

function globToRegExp(pattern: string): RegExp {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] as string;
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        source += '.*';
        index += 1;
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

/** The first rule a path matches, or `null`. A match on any segment matches the whole path. */
export function matchIgnoreRule(
  relativePath: string,
  rules: readonly IgnoreRule[] = DEFAULT_IGNORE_RULES,
): IgnoreRule | null {
  const segments = relativePath.split('/');
  for (const rule of rules) {
    const matcher = globToRegExp(rule.pattern);
    if (matcher.test(relativePath)) return rule;
    if (!rule.pattern.includes('/') && segments.some((segment) => matcher.test(segment))) {
      return rule;
    }
  }
  return null;
}

/**
 * Browser-side ZIP ceiling (task `054`). Conservative on purpose: zipping in a tab holds the
 * archive in memory and competes with everything else the page is doing. Above this, the review
 * step recommends the Mac agent instead of trying.
 */
export const CLIENT_ZIP_MAX_BYTES = 512 * 1024 * 1024;
/** And a file count, because ten thousand tiny files is its own kind of slow. */
export const CLIENT_ZIP_MAX_FILES = 5_000;

export const MAX_MANIFEST_ENTRIES = 20_000;

const checksumSchema = z.string().regex(/^[a-f0-9]{64}$/, 'must be a lowercase hex SHA-256');

export const manifestEntrySchema = z.object({
  path: z.string().min(1).max(MAX_RELATIVE_PATH),
  sizeBytes: z.number().int().nonnegative(),
  /** ISO timestamp from the source filesystem. */
  modifiedAt: z.string().datetime().nullable(),
  checksumSha256: checksumSchema.nullable(),
  ignored: z.boolean(),
  /** Why, for an ignored entry. Shown to people, so it is a sentence. */
  ignoreReason: z.string().max(200).nullable(),
});
export type ManifestEntry = z.infer<typeof manifestEntrySchema>;

export const createSnapshotSchema = z.object({
  projectId: projectIdSchema,
  /** The folder's own name — what the person picked. */
  name: z.string().trim().min(1).max(255),
  entries: z.array(manifestEntrySchema).min(1).max(MAX_MANIFEST_ENTRIES),
});
export type CreateSnapshotRequest = z.infer<typeof createSnapshotSchema>;

export const finalizeSnapshotSchema = z.object({ sessionId: uploadSessionIdSchema });
export type FinalizeSnapshotRequest = z.infer<typeof finalizeSnapshotSchema>;

export const snapshotIdSchema = ulidSchema;
