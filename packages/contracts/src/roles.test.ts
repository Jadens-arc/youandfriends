import { describe, expect, it } from 'vitest';

import { assetKindSchema, isAudioKind, ASSET_KINDS } from './assets';
import { isUlid, songIdSchema, ulidSchema } from './ids';
import { paginationRequestSchema, MAX_PAGE_SIZE } from './pagination';
import { attempt, err, isOk, ok, toResponseBody } from './result';
import { capabilitiesSchema, NO_ACCESS, roleAtLeast, roleSchema, ROLES } from './roles';

describe('roles', () => {
  it('defines exactly the four roles from the specification', () => {
    expect(ROLES).toEqual(['viewer', 'commenter', 'editor', 'owner']);
  });

  it('rejects an unknown role', () => {
    expect(roleSchema.safeParse('admin').success).toBe(false);
  });

  it.each([
    ['owner', 'editor', true],
    ['editor', 'editor', true],
    ['commenter', 'editor', false],
    ['viewer', 'commenter', false],
    ['owner', 'viewer', true],
  ] as const)('roleAtLeast(%s, %s) is %s', (role, minimum, expected) => {
    expect(roleAtLeast(role, minimum)).toBe(expected);
  });
});

describe('capabilities are independent of role', () => {
  it('permits a viewer who may download', () => {
    expect(capabilitiesSchema.parse({ canDownload: true, canInvite: false })).toEqual({
      canDownload: true,
      canInvite: false,
    });
  });

  it('permits an editor who may not download', () => {
    // docs/DESIGN.md §3 — download is granted separately from role.
    expect(capabilitiesSchema.parse({ canDownload: false, canInvite: true })).toEqual({
      canDownload: false,
      canInvite: true,
    });
  });

  it('denies by default', () => {
    expect(NO_ACCESS).toEqual({ role: null, canDownload: false, canInvite: false });
  });
});

describe('identifiers', () => {
  const valid = '01J8XKQ2M3N4P5R6S7T8V9W0XY';

  it('accepts a well-formed ULID', () => {
    expect(ulidSchema.safeParse(valid).success).toBe(true);
    expect(isUlid(valid)).toBe(true);
  });

  it.each([
    ['too short', '01J8XK'],
    // Derived from the valid ULID so the difference is the point, rather than buried in a
    // second opaque literal. Crockford base32 excludes I, L, O and U to avoid misreading.
    ['ambiguous letter I', `${valid.slice(0, -1)}I`],
    ['ambiguous letter L', `${valid.slice(0, -1)}L`],
    ['ambiguous letter O', `${valid.slice(0, -1)}O`],
    ['ambiguous letter U', `${valid.slice(0, -1)}U`],
    ['too long', `${valid}Z`],
    ['leading whitespace', ` ${valid}`],
    ['trailing whitespace', `${valid} `],
    ['lowercase', valid.toLowerCase()],
    ['sql injection attempt', "01J8XK'; DROP TABLE songs;--"],
    ['path traversal attempt', '../../etc/passwd'],
    ['empty', ''],
  ])('rejects %s', (_label, candidate) => {
    expect(ulidSchema.safeParse(candidate).success).toBe(false);
    expect(isUlid(candidate)).toBe(false);
  });

  it('parses into a branded type at the boundary', () => {
    expect(songIdSchema.parse(valid)).toBe(valid);
  });
});

describe('asset kinds', () => {
  it('has exactly one project-file kind — no Logic or MPC variant', () => {
    // docs/DESIGN.md §2: one Project Files area, organized by folders and tags.
    const projectFileKinds = ASSET_KINDS.filter((k) => k.includes('project') || k.includes('file'));
    expect(projectFileKinds).toEqual(['project_file']);
    expect(ASSET_KINDS.some((k) => /logic|mpc/i.test(k))).toBe(false);
  });

  it('routes audio kinds to the media pipeline and others not', () => {
    expect(isAudioKind('master')).toBe(true);
    expect(isAudioKind('voice_note')).toBe(true);
    expect(isAudioKind('project_file')).toBe(false);
    expect(isAudioKind('artwork')).toBe(false);
  });

  it('rejects an unknown kind', () => {
    expect(assetKindSchema.safeParse('logic_project').success).toBe(false);
  });
});

describe('pagination', () => {
  it('applies a default page size', () => {
    expect(paginationRequestSchema.parse({}).limit).toBe(50);
  });

  it('caps the page size so a client cannot request the whole library', () => {
    expect(paginationRequestSchema.safeParse({ limit: MAX_PAGE_SIZE + 1 }).success).toBe(false);
  });

  it('rejects a non-positive limit', () => {
    expect(paginationRequestSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(paginationRequestSchema.safeParse({ limit: -1 }).success).toBe(false);
  });
});

describe('result helpers', () => {
  it('narrows on ok', () => {
    const result = ok(42);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value).toBe(42);
  });

  it('carries the error on err', () => {
    const result = err(new Error('nope'));
    expect(result.ok).toBe(false);
  });

  it('captures a throw via attempt', async () => {
    const result = await attempt(() => {
      throw new Error('boom');
    });
    expect(result.ok).toBe(false);
  });

  it('routes every failure through one safe serializer', () => {
    const { status, body } = toResponseBody(new Error('internal detail'), 'c-9');
    expect(status).toBe(500);
    expect(body).toEqual({
      code: 'internal',
      message: 'Something went wrong on our end.',
      correlationId: 'c-9',
    });
  });
});
