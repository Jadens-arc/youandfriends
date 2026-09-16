import { NO_ACCESS, type Role } from '@youandfriends/contracts';
import { describe, expect, it } from 'vitest';

import { buildChain } from '../chain';
import { resolve, type MembershipBaseline, type ResolvableGrant } from '../resolve';
import {
  inheritsMembership,
  memberSubject,
  shareLinkSubject,
  subjectId,
  syncTokenSubject,
  anonymous,
  type Subject,
} from '../subjects';
import {
  denyWins,
  NAMED_CASES,
  ROLES_UNDER_TEST,
  SCOPE_LEVELS,
  SUBJECT_KINDS_UNDER_TEST,
  type LevelOrNone,
  type ScopeLevel,
  type SubjectKindUnderTest,
} from './matrix';

const NOW = new Date('2026-09-16T12:00:00Z');

const ANCESTOR = 'FOLDERANCESTOR000000000001';
const FOLDER = 'FOLDER00000000000000000001';
const PROJECT = 'PROJECT0000000000000000001';
const SONG = 'SONG000000000000000000001X';

/** A song two folder levels deep, which is the only chain shape the matrix needs. */
const CHAIN = buildChain({
  songId: SONG,
  projectId: PROJECT,
  folderPath: `/${ANCESTOR}/${FOLDER}/`,
});

const SCOPE_OF: Record<ScopeLevel, { scopeType: ResolvableGrant['scopeType']; scopeId: string }> = {
  ancestorFolder: { scopeType: 'folder', scopeId: ANCESTOR },
  folder: { scopeType: 'folder', scopeId: FOLDER },
  project: { scopeType: 'project', scopeId: PROJECT },
  song: { scopeType: 'song', scopeId: SONG },
};

function grantAt(level: ScopeLevel, values: Partial<ResolvableGrant> = {}): ResolvableGrant {
  return {
    ...SCOPE_OF[level],
    role: 'viewer',
    canDownload: null,
    canInvite: null,
    isDeny: false,
    startsAt: null,
    endsAt: null,
    ...values,
  };
}

function subjectOf(kind: SubjectKindUnderTest): Subject {
  switch (kind) {
    case 'member':
      return memberSubject('USER00000000000000000001XY' as never);
    case 'sync_token':
      return syncTokenSubject('TOKEN0000000000000000001XY');
    case 'share_link':
      return shareLinkSubject('LINK00000000000000000001XY');
    case 'anonymous':
      return anonymous;
  }
}

/** The baseline a subject actually carries: only a member inherits membership. */
function baselineFor(subject: Subject, role: Role | null): MembershipBaseline | null {
  if (role === null || !inheritsMembership(subject)) return null;
  return { role, canDownload: true, canInvite: false };
}

describe('the matrix covers every dimension', () => {
  // The completeness of a generated matrix is itself worth asserting: a sweep that silently
  // stopped covering `owner`, or `share_link`, would still pass every case it ran.
  it('sweeps every role', () => {
    expect(ROLES_UNDER_TEST).toEqual(['viewer', 'commenter', 'editor', 'owner']);
  });

  it('sweeps every scope depth, including a non-immediate ancestor', () => {
    expect(SCOPE_LEVELS).toEqual(['ancestorFolder', 'folder', 'project', 'song']);
  });

  it('sweeps every subject kind', () => {
    expect(SUBJECT_KINDS_UNDER_TEST).toEqual(['member', 'sync_token', 'share_link', 'anonymous']);
  });

  it('names a case for every subject kind', () => {
    const covered = new Set(NAMED_CASES.map((testCase) => testCase.subjectKind));
    expect([...covered].sort()).toEqual([...SUBJECT_KINDS_UNDER_TEST].sort());
  });
});

/**
 * The sweep: every grant level against every deny level, for every role and subject kind.
 *
 * The expectation comes from `denyWins`, a one-line rule stated in `matrix.ts` — *a deny wins
 * if and only if it sits at or above the winning grant's level* — which is a different
 * formulation from the resolver's facet walk. Deriving it from the resolver itself would
 * prove only that the resolver is deterministic.
 */
const LEVELS: readonly LevelOrNone[] = ['none', ...SCOPE_LEVELS];

describe('role × scope depth × deny override × subject kind', () => {
  const combinations = ROLES_UNDER_TEST.flatMap((role) =>
    SCOPE_LEVELS.flatMap((grantLevel) =>
      LEVELS.flatMap((denyLevel) =>
        SUBJECT_KINDS_UNDER_TEST.map((kind) => ({ role, grantLevel, denyLevel, kind })),
      ),
    ),
  );

  it('enumerates the full product', () => {
    expect(combinations).toHaveLength(4 * 4 * 5 * 4);
  });

  it.each(combinations)(
    '$kind with $role at $grantLevel, denied at $denyLevel',
    ({ role, grantLevel, denyLevel, kind }) => {
      const subject = subjectOf(kind);
      const grants = [grantAt(grantLevel, { role })];
      if (denyLevel !== 'none') {
        grants.push(grantAt(denyLevel, { role: null, isDeny: true }));
      }

      const access = resolve({
        chain: CHAIN,
        // Anonymous can hold no grant, because it has no id to hold one under. Asked of the
        // real function rather than by matching on the kind, so the sweep cannot disagree
        // with the implementation about which subjects those are.
        grants: subjectId(subject) === null ? [] : grants,
        membership: null,
        now: NOW,
      });

      if (subjectId(subject) === null) {
        expect(access).toEqual(NO_ACCESS);
        return;
      }

      const expected = denyWins(grantLevel, denyLevel) ? null : role;
      expect(access.role).toBe(expected);
      // A capability never survives a lost role: there is nothing to download if there is
      // nothing you can see.
      if (expected === null) expect(access.canDownload).toBe(false);
    },
  );
});

describe('capability × role, resolved independently', () => {
  const combinations = ROLES_UNDER_TEST.flatMap((role) =>
    [true, false].flatMap((canDownload) =>
      [true, false].map((canInvite) => ({ role, canDownload, canInvite })),
    ),
  );

  it.each(combinations)(
    '$role with download=$canDownload invite=$canInvite',
    ({ role, canDownload, canInvite }) => {
      const access = resolve({
        chain: CHAIN,
        grants: [grantAt('song', { role, canDownload, canInvite })],
        membership: null,
        now: NOW,
      });

      // Every combination is legal. Encoding capabilities as role tiers would make four of
      // these sixteen unreachable.
      expect(access).toEqual({ role, canDownload, canInvite });
    },
  );

  it('covers all sixteen combinations', () => {
    expect(combinations).toHaveLength(16);
  });
});

describe('membership baseline × subject kind', () => {
  const combinations = ROLES_UNDER_TEST.flatMap((role) =>
    SUBJECT_KINDS_UNDER_TEST.map((kind) => ({ role, kind })),
  );

  it.each(combinations)('$kind with workspace $role and no grants', ({ role, kind }) => {
    const subject = subjectOf(kind);
    const access = resolve({
      chain: CHAIN,
      grants: [],
      membership: baselineFor(subject, role),
      now: NOW,
    });

    // Only a member inherits the workspace baseline. A share-link bearer or a sync token
    // holding one would turn every shared song into an invitation (THREAT_MODEL T5).
    expect(access.role).toBe(kind === 'member' ? role : null);
  });
});

describe('named cases', () => {
  it.each(NAMED_CASES)('$name', (testCase) => {
    const subject = subjectOf(testCase.subjectKind);
    const grants: ResolvableGrant[] = [];

    if (testCase.grantLevel !== 'none') {
      grants.push(grantAt(testCase.grantLevel, { role: testCase.grantRole }));
    }
    if (testCase.denyLevel !== 'none') {
      grants.push(grantAt(testCase.denyLevel, { role: null, isDeny: true }));
    }
    if (testCase.canDownloadAt) {
      const existing = grants.find(
        (grant) =>
          grant.scopeType === SCOPE_OF[testCase.canDownloadAt!.level].scopeType &&
          grant.scopeId === SCOPE_OF[testCase.canDownloadAt!.level].scopeId,
      );
      if (existing) {
        grants[grants.indexOf(existing)] = {
          ...existing,
          canDownload: testCase.canDownloadAt.value,
        };
      } else {
        grants.push(
          grantAt(testCase.canDownloadAt.level, {
            role: null,
            canDownload: testCase.canDownloadAt.value,
          }),
        );
      }
    }

    const access = resolve({
      chain: CHAIN,
      grants: subjectId(subject) === null ? [] : grants,
      membership: baselineFor(subject, testCase.membershipRole),
      now: NOW,
    });

    expect(access.role).toBe(testCase.expectedRole);
    expect(access.canDownload).toBe(testCase.expectedDownload);
  });
});
