import { NO_ACCESS, type Role } from '@youandfriends/contracts';
import { describe, expect, it } from 'vitest';

import { buildChain, foldersInPath } from './chain';
import { isActive, resolve, type ResolvableGrant } from './resolve';

const NOW = new Date('2026-09-16T12:00:00Z');

const FOLDER = 'FOLDER00000000000000000001';
const PARENT = 'FOLDER00000000000000000000';
const PROJECT = 'PROJECT0000000000000000001';
const SONG = 'SONG000000000000000000001X';

/** The chain for a song two folders deep: song → project → folder → parent folder. */
const chain = buildChain({
  songId: SONG,
  projectId: PROJECT,
  folderPath: `/${PARENT}/${FOLDER}/`,
});

function grant(overrides: Partial<ResolvableGrant> = {}): ResolvableGrant {
  return {
    scopeType: 'folder',
    scopeId: FOLDER,
    role: 'viewer',
    canDownload: null,
    canInvite: null,
    isDeny: false,
    startsAt: null,
    endsAt: null,
    ...overrides,
  };
}

const at = (grants: readonly ResolvableGrant[], membership = null) =>
  resolve({ chain, grants, membership, now: NOW });

describe('the chain', () => {
  it('runs from the target outwards, most specific first', () => {
    expect(chain.map((link) => [link.scopeType, link.scopeId])).toEqual([
      ['song', SONG],
      ['project', PROJECT],
      ['folder', FOLDER],
      ['folder', PARENT],
    ]);
  });

  it('ranks a deeper folder above its own ancestor', () => {
    const folderLink = chain.find((link) => link.scopeId === FOLDER);
    const parentLink = chain.find((link) => link.scopeId === PARENT);
    expect(folderLink?.specificity).toBeGreaterThan(parentLink?.specificity ?? 0);
  });

  it('includes every ancestor, not only the immediate parent', () => {
    // A grant four levels up is only found if that level is in the chain. "Immediate parent
    // only" would silently drop access an owner believes they granted.
    const deep = buildChain({ targetFolderPath: '/A/B/C/D/E/' });
    expect(deep).toHaveLength(5);
  });

  it('handles a project filed nowhere', () => {
    expect(buildChain({ projectId: PROJECT })).toEqual([
      { scopeType: 'project', scopeId: PROJECT, specificity: 1 },
    ]);
  });

  it('reads ids out of a materialized path', () => {
    expect(foldersInPath('/A/B/C/')).toEqual(['A', 'B', 'C']);
    expect(foldersInPath('')).toEqual([]);
  });
});

describe('deny by default', () => {
  it('gives nothing to a subject with no grants and no membership', () => {
    // A resource class nobody has wired up is unreachable, not accidentally public.
    expect(at([])).toEqual(NO_ACCESS);
  });

  it('ignores a grant on a scope outside this target’s chain', () => {
    const elsewhere = grant({ scopeId: 'FOLDER00000000000000000099', role: 'owner' });
    expect(at([elsewhere])).toEqual(NO_ACCESS);
  });
});

describe('inheritance and specificity', () => {
  it('inherits a folder grant down to the song', () => {
    expect(at([grant({ role: 'commenter' })]).role).toBe('commenter');
  });

  it('lets the most specific grant win, upwards or downwards', () => {
    const folderEditor = grant({ role: 'editor' });
    const songViewer = grant({ scopeType: 'song', scopeId: SONG, role: 'viewer' });

    // Most specific wins even when it grants *less*. An owner narrowing one song to viewer
    // is a thing people do, and "highest role wins" would quietly ignore them.
    expect(at([folderEditor, songViewer]).role).toBe('viewer');
  });

  it('prefers a nearer folder to a more distant one', () => {
    const near = grant({ scopeId: FOLDER, role: 'viewer' });
    const far = grant({ scopeId: PARENT, role: 'owner' });
    expect(at([far, near]).role).toBe('viewer');
  });

  it('beats the workspace baseline with any grant on the chain', () => {
    const membership = { role: 'viewer' as Role, canDownload: true, canInvite: false };
    const access = resolve({ chain, grants: [grant({ role: 'editor' })], membership, now: NOW });
    expect(access.role).toBe('editor');
  });

  it('falls back to the workspace baseline when no grant speaks', () => {
    const membership = { role: 'commenter' as Role, canDownload: true, canInvite: true };
    expect(resolve({ chain, grants: [], membership, now: NOW })).toEqual({
      role: 'commenter',
      canDownload: true,
      canInvite: true,
    });
  });
});

describe('deny', () => {
  it('overrides an allow inherited from further up', () => {
    const folderEditor = grant({ role: 'editor' });
    const songDeny = grant({ scopeType: 'song', scopeId: SONG, role: null, isDeny: true });

    expect(at([folderEditor, songDeny])).toEqual(NO_ACCESS);
  });

  it('does not override a grant more specific than itself', () => {
    // "A deny overrides an inherited allow" means it overrides what is *less* specific than
    // itself. A song-level grant under a folder-level deny is still the more specific
    // statement, and still wins.
    const folderDeny = grant({ role: null, isDeny: true });
    const songEditor = grant({ scopeType: 'song', scopeId: SONG, role: 'editor' });

    expect(at([folderDeny, songEditor]).role).toBe('editor');
  });

  it('overrides the workspace baseline', () => {
    const membership = { role: 'owner' as Role, canDownload: true, canInvite: true };
    const denied = resolve({
      chain,
      grants: [grant({ role: null, isDeny: true })],
      membership,
      now: NOW,
    });
    expect(denied).toEqual(NO_ACCESS);
  });

  it('takes the capabilities with it', () => {
    const allow = grant({ role: 'editor', canDownload: true, canInvite: true });
    const deny = grant({ scopeType: 'song', scopeId: SONG, role: null, isDeny: true });

    expect(at([allow, deny])).toEqual(NO_ACCESS);
  });
});

describe('capabilities resolve independently of role', () => {
  it('permits a viewer to download', () => {
    const access = at([grant({ role: 'viewer', canDownload: true })]);
    expect(access).toEqual({ role: 'viewer', canDownload: true, canInvite: false });
  });

  it('permits an editor who may not download', () => {
    const access = at([grant({ role: 'editor', canDownload: false })]);
    expect(access).toEqual({ role: 'editor', canDownload: false, canInvite: false });
  });

  it('leaves an inherited capability alone when a nearer grant is silent about it', () => {
    // This is why the columns are nullable. Raising someone to editor on one song must not
    // quietly revoke the download permission they hold on the folder — and a `false` default
    // would make that revocation look deliberate.
    const folder = grant({ role: 'viewer', canDownload: true });
    const song = grant({ scopeType: 'song', scopeId: SONG, role: 'editor' });

    expect(at([folder, song])).toEqual({ role: 'editor', canDownload: true, canInvite: false });
  });

  it('lets a nearer grant revoke a capability while inheriting the role', () => {
    const folder = grant({ role: 'editor', canDownload: true });
    const song = grant({ scopeType: 'song', scopeId: SONG, role: null, canDownload: false });

    // A grant with no role is silent about role, so the folder's editor still applies.
    expect(at([folder, song])).toEqual({ role: 'editor', canDownload: false, canInvite: false });
  });

  it('refuses a capability with no role to attach it to', () => {
    // There is nothing to download if there is nothing you can see.
    const orphan = grant({ role: null, canDownload: true, isDeny: false });
    expect(at([orphan])).toEqual(NO_ACCESS);
  });
});

describe('active windows', () => {
  const window = (startsAt: string | null, endsAt: string | null) =>
    grant({
      role: 'editor',
      startsAt: startsAt === null ? null : new Date(startsAt),
      endsAt: endsAt === null ? null : new Date(endsAt),
    });

  it('ignores a grant that has not started', () => {
    expect(at([window('2026-10-01T00:00:00Z', null)])).toEqual(NO_ACCESS);
  });

  it('ignores a grant that has ended', () => {
    expect(at([window(null, '2026-09-01T00:00:00Z')])).toEqual(NO_ACCESS);
  });

  it('honours a grant inside its window', () => {
    expect(at([window('2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z')]).role).toBe('editor');
  });

  it('ends exclusively, so "until Friday" is over when Friday arrives', () => {
    expect(isActive(window(null, NOW.toISOString()), NOW)).toBe(false);
    expect(isActive(window(NOW.toISOString(), null), NOW)).toBe(true);
  });

  it('falls through an expired grant to a less specific one', () => {
    const expiredSong = grant({
      scopeType: 'song',
      scopeId: SONG,
      role: 'owner',
      endsAt: new Date('2026-09-01T00:00:00Z'),
    });
    const folderViewer = grant({ role: 'viewer' });

    // An expired grant is not a deny. It is simply not there.
    expect(at([expiredSong, folderViewer]).role).toBe('viewer');
  });

  it('falls through an expired deny, restoring inherited access', () => {
    const expiredDeny = grant({
      scopeType: 'song',
      scopeId: SONG,
      role: null,
      isDeny: true,
      endsAt: new Date('2026-09-01T00:00:00Z'),
    });
    expect(at([expiredDeny, grant({ role: 'editor' })]).role).toBe('editor');
  });
});
