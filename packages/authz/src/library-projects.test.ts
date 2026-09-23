import type { Role } from '@youandfriends/contracts';
import { describe, expect, it } from 'vitest';

import {
  libraryAccessFrom,
  projectCollaboratorsFrom,
  type MemberBaselineRow,
  type MemberGrant,
  type ProjectChain,
} from './library';
import type { MembershipBaseline, ResolvableGrant } from './resolve';

/**
 * Project and song visibility for the project library (task `041`), pure.
 *
 * Every case below is built so the rule under test changes the answer (CLAUDE.md §13): a
 * project-level deny sits *under* a folder the member can see, a song-level deny sits under a
 * project they can see, a scope-limited collaborator's folder grant is two levels above the
 * project it has to reach, and each "does not count" grant (expired, deny) would otherwise have
 * counted.
 */

const NOW = new Date('2026-09-23T12:00:00Z');
const EARLIER = new Date('2026-09-01T00:00:00Z');

const ROOT = 'FOLDER0000000000000000ROOT';
const CHILD = 'FOLDER0000000000000000CHLD';
const OTHER = 'FOLDER000000000000000OTHER';
const DEEP_PATH = `/${ROOT}/${CHILD}/`;

const PROJECT = 'PROJECT00000000000000DEEP1';
const DENIED_PROJECT = 'PROJECT0000000000000DENIED';
const OTHER_PROJECT = 'PROJECT00000000000000OTHER';
const UNFILED = 'PROJECT000000000000UNFILED';
const SONG = 'SONG0000000000000000000001';
const DENIED_SONG = 'SONG000000000000000DENIED';

function membership(role: Role): MembershipBaseline {
  return { role, canDownload: false, canInvite: false };
}

function grant(
  overrides: Partial<ResolvableGrant> & Pick<ResolvableGrant, 'scopeType' | 'scopeId'>,
): ResolvableGrant {
  return {
    role: 'viewer',
    canDownload: null,
    canInvite: null,
    isDeny: false,
    startsAt: null,
    endsAt: null,
    ...overrides,
  };
}

describe('libraryAccessFrom', () => {
  describe('for a full member with denies', () => {
    const access = libraryAccessFrom(
      [
        grant({ scopeType: 'project', scopeId: DENIED_PROJECT, role: null, isDeny: true }),
        grant({ scopeType: 'song', scopeId: DENIED_SONG, role: null, isDeny: true }),
      ],
      membership('editor'),
      NOW,
    );

    it('sees a project deep in the tree through membership', () => {
      expect(access.project(PROJECT, DEEP_PATH)).toBe('editor');
      expect(access.project(UNFILED, '')).toBe('editor');
    });

    it('loses a project denied at the project itself, even under a visible folder', () => {
      expect(access.folder(DEEP_PATH)).toBe('editor');
      expect(access.project(DENIED_PROJECT, DEEP_PATH)).toBeNull();
    });

    it('loses every song of a denied project', () => {
      expect(access.song(SONG, DENIED_PROJECT, DEEP_PATH)).toBeNull();
    });

    it('loses a denied song while keeping its project', () => {
      expect(access.project(PROJECT, DEEP_PATH)).toBe('editor');
      expect(access.song(DENIED_SONG, PROJECT, DEEP_PATH)).toBeNull();
      expect(access.song(SONG, PROJECT, DEEP_PATH)).toBe('editor');
    });

    it('counts nothing as shared — membership is not a share, and a deny is not either', () => {
      expect(access.sharedProject(PROJECT, DEEP_PATH)).toBe(false);
      expect(access.sharedProject(DENIED_PROJECT, DEEP_PATH)).toBe(false);
      expect(access.directlySharedSongIds).toEqual([]);
    });

    it('names the songs denied to them directly, and only those', () => {
      expect(access.deniedSongIds).toEqual([DENIED_SONG]);
    });
  });

  describe('for a scope-limited collaborator', () => {
    const access = libraryAccessFrom(
      [
        grant({ scopeType: 'folder', scopeId: ROOT, role: 'commenter' }),
        grant({ scopeType: 'song', scopeId: SONG, role: 'viewer' }),
        grant({ scopeType: 'project', scopeId: OTHER_PROJECT, role: 'viewer', endsAt: EARLIER }),
      ],
      null,
      NOW,
    );

    it('reaches a project two folders below the granted one', () => {
      expect(access.project(PROJECT, DEEP_PATH)).toBe('commenter');
      expect(access.sharedProject(PROJECT, DEEP_PATH)).toBe(true);
    });

    it('sees nothing outside the grant — not another root, not an unfiled project', () => {
      expect(access.folder(`/${OTHER}/`)).toBeNull();
      expect(access.project(UNFILED, '')).toBeNull();
    });

    it('reaches a song shared on its own without reaching its project', () => {
      expect(access.song(SONG, UNFILED, '')).toBe('viewer');
      expect(access.project(UNFILED, '')).toBeNull();
      expect(access.directlySharedSongIds).toEqual([SONG]);
    });

    it('has no denied songs to hide', () => {
      expect(access.deniedSongIds).toEqual([]);
    });

    it('ignores an expired grant, for access and for "shared with me" alike', () => {
      expect(access.project(OTHER_PROJECT, `/${OTHER}/`)).toBeNull();
      expect(access.sharedProject(OTHER_PROJECT, `/${OTHER}/`)).toBe(false);
    });
  });

  it('refuses a stranger everything', () => {
    const access = libraryAccessFrom([], null, NOW);
    expect(access.project(PROJECT, DEEP_PATH)).toBeNull();
    expect(access.song(SONG, PROJECT, DEEP_PATH)).toBeNull();
    expect(access.folder(DEEP_PATH)).toBeNull();
  });
});

describe('projectCollaboratorsFrom', () => {
  const OWNER = 'USER00000000000000000OWNER';
  const DENIED_EDITOR = 'USER0000000000000000DENIED';
  const COLLABORATOR = 'USER000000000000000COLLAB';
  const EXPIRED = 'USER00000000000000EXPIRED';

  const members: MemberBaselineRow[] = [
    { userId: OWNER, role: 'owner', canDownload: true, canInvite: true },
    { userId: DENIED_EDITOR, role: 'editor', canDownload: false, canInvite: false },
    { userId: COLLABORATOR, role: null, canDownload: false, canInvite: false },
    { userId: EXPIRED, role: null, canDownload: false, canInvite: false },
  ];

  const grants: MemberGrant[] = [
    {
      userId: DENIED_EDITOR,
      ...grant({ scopeType: 'folder', scopeId: CHILD, role: null, isDeny: true }),
    },
    { userId: COLLABORATOR, ...grant({ scopeType: 'folder', scopeId: ROOT }) },
    {
      userId: EXPIRED,
      ...grant({ scopeType: 'project', scopeId: UNFILED, endsAt: EARLIER }),
    },
  ];

  const projects: ProjectChain[] = [
    { id: PROJECT, folderPath: DEEP_PATH },
    { id: UNFILED, folderPath: '' },
  ];

  const result = projectCollaboratorsFrom(projects, members, grants, NOW);

  it('lists exactly the people a project is open to', () => {
    // The editor is denied on CHILD, which PROJECT sits in; the collaborator's ROOT grant
    // reaches it two levels down.
    expect(result.get(PROJECT)).toEqual([OWNER, COLLABORATOR]);
  });

  it('never lists a scope-limited collaborator where their grants do not reach', () => {
    // Unfiled: only membership reaches it, and the expired project grant does not count.
    expect(result.get(UNFILED)).toEqual([OWNER, DENIED_EDITOR]);
  });
});
