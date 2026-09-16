import type { Role } from '@youandfriends/contracts';

/**
 * The permission matrix, as data.
 *
 * Two things read this table: `matrix.test.ts`, which runs every row against the real
 * resolver, and `scripts/generate-permission-matrix.mjs`, which writes
 * `docs/PERMISSION_MATRIX.md` from it. Prose cannot drift from behaviour when both come from
 * the same source, and `release-check` fails if the document is stale.
 *
 * **Expectations here are stated, never computed.** A test that derives its expected answer
 * from the same algorithm it is testing proves only that the algorithm is deterministic. The
 * combinatorial rows below use one independent one-line rule — *a deny wins if and only if it
 * sits at or above the winning grant's level* — which is a different formulation from the
 * implementation's facet walk, and the named rows state their answers outright.
 */

/** Where in the chain a grant sits. Index is specificity: higher is nearer the target. */
export const SCOPE_LEVELS = ['ancestorFolder', 'folder', 'project', 'song'] as const;
export type ScopeLevel = (typeof SCOPE_LEVELS)[number];

/** `null` means "no grant at all at this level". */
export type LevelOrNone = ScopeLevel | 'none';

export const ROLES_UNDER_TEST: readonly Role[] = ['viewer', 'commenter', 'editor', 'owner'];

export const SUBJECT_KINDS_UNDER_TEST = [
  'member',
  'sync_token',
  'share_link',
  'anonymous',
] as const;
export type SubjectKindUnderTest = (typeof SUBJECT_KINDS_UNDER_TEST)[number];

/** How specific a level is. Used by the rule below, and by nothing in the implementation. */
export function specificityOf(level: ScopeLevel): number {
  return SCOPE_LEVELS.indexOf(level);
}

/**
 * The rule, stated independently of the resolver.
 *
 * A deny wins if and only if it sits at or above the winning grant's level. "Above" means
 * nearer the target: a deny on the song beats an allow on the folder, and an allow on the
 * song beats a deny on the folder. Equal levels cannot both exist — a unique index forbids
 * two grants for one subject on one scope — but the comparison is written `>=` so that if
 * that index were ever dropped, the safer answer is the one that falls out.
 */
export function denyWins(grantLevel: LevelOrNone, denyLevel: LevelOrNone): boolean {
  if (denyLevel === 'none') return false;
  if (grantLevel === 'none') return true;
  return specificityOf(denyLevel) >= specificityOf(grantLevel);
}

/** A named case with its expectation written out, for the cases worth reading. */
export interface MatrixCase {
  readonly name: string;
  /** What the collaborator was given, in the words an owner would use. */
  readonly given: string;
  readonly grantLevel: LevelOrNone;
  readonly grantRole: Role | null;
  readonly denyLevel: LevelOrNone;
  readonly membershipRole: Role | null;
  readonly canDownloadAt?: { level: ScopeLevel; value: boolean } | undefined;
  readonly subjectKind: SubjectKindUnderTest;
  readonly expectedRole: Role | null;
  readonly expectedDownload: boolean;
  /** Why this case exists. Rendered into the document. */
  readonly because: string;
}

/**
 * The cases worth reading, with their answers written out.
 *
 * The combinatorial sweep in `matrix.test.ts` covers the whole product; these exist because
 * a table of 320 generated rows documents nothing. Each one is a sentence an owner might say.
 */
export const NAMED_CASES: readonly MatrixCase[] = [
  {
    name: 'folder access reaches the song inside it',
    given: 'commenter on the folder',
    grantLevel: 'folder',
    grantRole: 'commenter',
    denyLevel: 'none',
    membershipRole: null,
    subjectKind: 'member',
    expectedRole: 'commenter',
    expectedDownload: false,
    because: 'Grants inherit downward — docs/DESIGN.md §3.',
  },
  {
    name: 'a distant ancestor still grants',
    given: 'viewer on a folder two levels up',
    grantLevel: 'ancestorFolder',
    grantRole: 'viewer',
    denyLevel: 'none',
    membershipRole: null,
    subjectKind: 'member',
    expectedRole: 'viewer',
    expectedDownload: false,
    because: 'Inheritance is not limited to the immediate parent.',
  },
  {
    name: 'the nearer grant wins, even granting less',
    given: 'editor on the folder, viewer on the song',
    grantLevel: 'song',
    grantRole: 'viewer',
    denyLevel: 'none',
    membershipRole: null,
    subjectKind: 'member',
    expectedRole: 'viewer',
    expectedDownload: false,
    because:
      'Most specific wins, including when it grants less. Narrowing one song is a thing owners do.',
  },
  {
    name: 'a deny on the song beats an allow on the folder',
    given: 'editor on the folder, denied on the song',
    grantLevel: 'folder',
    grantRole: 'editor',
    denyLevel: 'song',
    membershipRole: null,
    subjectKind: 'member',
    expectedRole: null,
    expectedDownload: false,
    because: 'An explicit deny overrides an allow inherited from less specific scope.',
  },
  {
    name: 'a grant on the song beats a deny on the folder',
    given: 'denied on the folder, editor on the song',
    grantLevel: 'song',
    grantRole: 'editor',
    denyLevel: 'folder',
    membershipRole: null,
    subjectKind: 'member',
    expectedRole: 'editor',
    expectedDownload: false,
    because:
      'A deny overrides what is *less* specific than itself, never what is more. Read the rule carefully.',
  },
  {
    name: 'a deny overrides workspace membership',
    given: 'workspace owner, denied on the song',
    grantLevel: 'none',
    grantRole: null,
    denyLevel: 'song',
    membershipRole: 'owner',
    subjectKind: 'member',
    expectedRole: null,
    expectedDownload: false,
    because: 'Membership is the least specific statement there is.',
  },
  {
    name: 'membership is the baseline when nothing else speaks',
    given: 'workspace editor, no grants',
    grantLevel: 'none',
    grantRole: null,
    denyLevel: 'none',
    membershipRole: 'editor',
    subjectKind: 'member',
    expectedRole: 'editor',
    expectedDownload: true,
    because: 'Members can reach their own workspace without a grant per song.',
  },
  {
    name: 'a viewer may be permitted to download',
    given: 'viewer on the song, download allowed',
    grantLevel: 'song',
    grantRole: 'viewer',
    denyLevel: 'none',
    membershipRole: null,
    canDownloadAt: { level: 'song', value: true },
    subjectKind: 'member',
    expectedRole: 'viewer',
    expectedDownload: true,
    because: 'Capabilities are independent of role — docs/DESIGN.md §3.',
  },
  {
    name: 'an editor may be refused download',
    given: 'editor on the song, download refused',
    grantLevel: 'song',
    grantRole: 'editor',
    denyLevel: 'none',
    membershipRole: null,
    canDownloadAt: { level: 'song', value: false },
    subjectKind: 'member',
    expectedRole: 'editor',
    expectedDownload: false,
    because: 'The same independence, in the other direction.',
  },
  {
    name: 'a nearer role grant leaves an inherited capability alone',
    given: 'viewer + download on the folder, editor on the song',
    grantLevel: 'song',
    grantRole: 'editor',
    denyLevel: 'none',
    membershipRole: null,
    canDownloadAt: { level: 'folder', value: true },
    subjectKind: 'member',
    expectedRole: 'editor',
    expectedDownload: true,
    because:
      'A grant silent about a capability does not revoke it. This is why the column is nullable.',
  },
  {
    name: 'a share-link bearer gets no membership baseline',
    given: 'workspace owner elsewhere, arriving by share link',
    grantLevel: 'none',
    grantRole: null,
    denyLevel: 'none',
    membershipRole: 'owner',
    subjectKind: 'share_link',
    expectedRole: null,
    expectedDownload: false,
    because:
      'A link to one song must never become a key to the workspace — docs/THREAT_MODEL.md T5.',
  },
  {
    name: 'a sync token gets no membership baseline either',
    given: 'a Mac agent token, no explicit grant',
    grantLevel: 'none',
    grantRole: null,
    denyLevel: 'none',
    membershipRole: 'editor',
    subjectKind: 'sync_token',
    expectedRole: null,
    expectedDownload: false,
    because: 'A token is authorized against what it was issued for, never against a workspace.',
  },
  {
    name: 'a sync token honours an explicit grant',
    given: 'a Mac agent token, editor on the folder it syncs',
    grantLevel: 'folder',
    grantRole: 'editor',
    denyLevel: 'none',
    membershipRole: null,
    subjectKind: 'sync_token',
    expectedRole: 'editor',
    expectedDownload: false,
    because: 'Explicit grants are how a non-member subject gets anything at all.',
  },
  {
    name: 'nobody gets nothing',
    given: 'not signed in',
    grantLevel: 'none',
    grantRole: null,
    denyLevel: 'none',
    membershipRole: null,
    subjectKind: 'anonymous',
    expectedRole: null,
    expectedDownload: false,
    because: 'Deny by default. An unwired resource class is unreachable, not public — ADR 0006.',
  },
  {
    name: 'a stranger gets nothing',
    given: 'signed in, no membership, no grant',
    grantLevel: 'none',
    grantRole: null,
    denyLevel: 'none',
    membershipRole: null,
    subjectKind: 'member',
    expectedRole: null,
    expectedDownload: false,
    because: 'Being signed in is not access.',
  },
];
