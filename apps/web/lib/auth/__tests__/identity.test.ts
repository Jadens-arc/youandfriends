import { describe, expect, it, vi } from 'vitest';

const currentUser = vi.hoisted(() => vi.fn());
vi.mock('@clerk/nextjs/server', () => ({ currentUser }));
vi.mock('server-only', () => ({}));

const { clerkIdentityReader } = await import('../current-session');

/**
 * The field selection on Clerk's user object.
 *
 * Not a mock standing in for the integration (CLAUDE.md §7) — the real `currentUser()` is what
 * production calls, and the build verifies the wiring. What is asserted here is our own
 * choosing: which fields we read, and what we do when they are absent, neither of which needs
 * a network to be wrong.
 */
describe('reading a Clerk identity', () => {
  it('returns nothing when nobody is signed in', async () => {
    currentUser.mockResolvedValueOnce(null);
    expect(await clerkIdentityReader()).toBeNull();
  });

  it('prefers the primary email over the first in the list', async () => {
    currentUser.mockResolvedValueOnce({
      id: 'user_1',
      primaryEmailAddress: { emailAddress: 'primary@example.test' },
      emailAddresses: [{ emailAddress: 'old@example.test' }],
      firstName: 'Avery',
      lastName: null,
      username: null,
    });

    const identity = await clerkIdentityReader();
    expect(identity?.email).toBe('primary@example.test');
    expect(identity?.displayName).toBe('Avery');
  });

  it('falls back to the first address when there is no primary', async () => {
    currentUser.mockResolvedValueOnce({
      id: 'user_2',
      primaryEmailAddress: null,
      emailAddresses: [{ emailAddress: 'only@example.test' }],
      firstName: null,
      lastName: null,
      username: 'avery',
    });

    const identity = await clerkIdentityReader();
    expect(identity?.email).toBe('only@example.test');
    expect(identity?.displayName).toBe('avery');
  });

  it('never uses the email as a display name', async () => {
    // A display name is rendered beside comments and in presence. Falling back to the address
    // would leak it to everyone the workspace is shared with — a privacy regression nobody
    // would notice shipping, because it looks like a sensible default.
    currentUser.mockResolvedValueOnce({
      id: 'user_3',
      primaryEmailAddress: { emailAddress: 'private@example.test' },
      emailAddresses: [],
      firstName: null,
      lastName: null,
      username: null,
    });

    const identity = await clerkIdentityReader();
    expect(identity?.displayName).not.toContain('@');
    expect(identity?.displayName).toBe('Someone');
  });

  it('reports an empty email rather than inventing one', async () => {
    // Resolution refuses on this, which is the closed answer. Fabricating an address would
    // put it in the audit log and on a future invitation.
    currentUser.mockResolvedValueOnce({
      id: 'user_4',
      primaryEmailAddress: null,
      emailAddresses: [],
      firstName: 'Sam',
      lastName: null,
      username: null,
    });

    expect((await clerkIdentityReader())?.email).toBe('');
  });
});
