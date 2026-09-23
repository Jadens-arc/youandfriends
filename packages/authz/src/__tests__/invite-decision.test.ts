import { NO_ACCESS, type EffectiveAccess } from '@youandfriends/contracts';
import { describe, expect, it } from 'vitest';

import {
  canGrantAccess,
  describeGrantRefusal,
  inviteRequestSchema,
  normalizeEmail,
} from '../invitations';

const access = (overrides: Partial<EffectiveAccess> = {}): EffectiveAccess => ({
  ...NO_ACCESS,
  role: 'editor',
  ...overrides,
});

/**
 * What each rule needs before it can bite (CLAUDE.md §13): a role comparison needs an
 * inviter **below** the requested role, and each capability cap needs an inviter who lacks
 * exactly that one capability while holding the other — a fixture that always gave both or
 * neither would never exercise them independently.
 */
describe('capping what an invitation may offer', () => {
  it('permits inviting at or below the inviter’s own role', () => {
    for (const role of ['viewer', 'commenter', 'editor'] as const) {
      expect(
        canGrantAccess(access({ role: 'editor' }), { role, canDownload: false, canInvite: false }),
      ).toBe(true);
    }
  });

  it('refuses inviting above the inviter’s own role', () => {
    expect(
      canGrantAccess(access({ role: 'commenter' }), {
        role: 'editor',
        canDownload: false,
        canInvite: false,
      }),
    ).toBe(false);
  });

  it('refuses entirely for someone with no role here at all', () => {
    expect(
      canGrantAccess(access({ role: null }), {
        role: 'viewer',
        canDownload: false,
        canInvite: false,
      }),
    ).toBe(false);
  });

  it('refuses granting download the inviter does not themselves hold', () => {
    const inviter = access({ role: 'editor', canDownload: false, canInvite: true });
    expect(canGrantAccess(inviter, { role: 'viewer', canDownload: true, canInvite: false })).toBe(
      false,
    );
    // The same inviter, asking for nothing above their own download permission — allowed.
    expect(canGrantAccess(inviter, { role: 'viewer', canDownload: false, canInvite: false })).toBe(
      true,
    );
  });

  it('refuses granting invite the inviter does not themselves hold', () => {
    const inviter = access({ role: 'editor', canDownload: true, canInvite: false });
    expect(canGrantAccess(inviter, { role: 'viewer', canDownload: false, canInvite: true })).toBe(
      false,
    );
  });

  it('permits an inviter to pass on exactly the capabilities they hold', () => {
    const inviter = access({ role: 'editor', canDownload: true, canInvite: true });
    expect(canGrantAccess(inviter, { role: 'editor', canDownload: true, canInvite: true })).toBe(
      true,
    );
  });

  it('never confuses download and invite — each is capped on its own facet', () => {
    // Holds download, not invite: may pass on download, may not pass on invite, independently.
    const inviter = access({ role: 'editor', canDownload: true, canInvite: false });
    expect(canGrantAccess(inviter, { role: 'viewer', canDownload: true, canInvite: false })).toBe(
      true,
    );
    expect(canGrantAccess(inviter, { role: 'viewer', canDownload: false, canInvite: true })).toBe(
      false,
    );
  });
});

describe('explaining a refusal', () => {
  it('names the specific reason, not a generic one, for each cap', () => {
    expect(
      describeGrantRefusal(access({ role: null }), {
        role: 'viewer',
        canDownload: false,
        canInvite: false,
      }),
    ).toMatch(/do not have access/i);

    expect(
      describeGrantRefusal(access({ role: 'viewer' }), {
        role: 'editor',
        canDownload: false,
        canInvite: false,
      }),
    ).toMatch(/higher role/i);

    expect(
      describeGrantRefusal(access({ role: 'editor', canDownload: false }), {
        role: 'viewer',
        canDownload: true,
        canInvite: false,
      }),
    ).toMatch(/download/i);

    expect(
      describeGrantRefusal(access({ role: 'editor', canInvite: false }), {
        role: 'viewer',
        canDownload: false,
        canInvite: true,
      }),
    ).toMatch(/invite/i);
  });
});

describe('normalizing an email address', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Sam@Example.TEST  ')).toBe('sam@example.test');
  });
});

describe('the invite request schema', () => {
  it('accepts a well-formed request and normalizes the email', () => {
    const parsed = inviteRequestSchema.parse({
      email: '  Sam@Example.TEST  ',
      scopeType: 'song',
      scopeId: '01J8XKQ2M3N4P5R6S7T8V9W0XY',
      role: 'viewer',
      canDownload: false,
      canInvite: false,
    });
    expect(parsed.email).toBe('sam@example.test');
  });

  it('refuses an invalid email', () => {
    expect(
      inviteRequestSchema.safeParse({
        email: 'not-an-email',
        scopeType: 'song',
        scopeId: '01J8XKQ2M3N4P5R6S7T8V9W0XY',
        role: 'viewer',
        canDownload: false,
        canInvite: false,
      }).success,
    ).toBe(false);
  });

  it('refuses owner as an invited role, even though it is a real Role elsewhere', () => {
    expect(
      inviteRequestSchema.safeParse({
        email: 'sam@example.test',
        scopeType: 'song',
        scopeId: '01J8XKQ2M3N4P5R6S7T8V9W0XY',
        role: 'owner',
        canDownload: false,
        canInvite: false,
      }).success,
    ).toBe(false);
  });

  it('refuses a scope type outside folder/project/song', () => {
    expect(
      inviteRequestSchema.safeParse({
        email: 'sam@example.test',
        scopeType: 'workspace',
        scopeId: '01J8XKQ2M3N4P5R6S7T8V9W0XY',
        role: 'viewer',
        canDownload: false,
        canInvite: false,
      }).success,
    ).toBe(false);
  });
});
