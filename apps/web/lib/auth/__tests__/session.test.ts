import { describe, expect, it, vi } from 'vitest';

import type { ClerkIdentity } from '../provision';
import { resolveSession } from '../session';

const provisionUser = vi.hoisted(() => vi.fn());
const authDatabase = vi.hoisted(() => vi.fn(() => ({}) as never));

vi.mock('../provision', () => ({ provisionUser, authDatabase }));

const identity: ClerkIdentity = {
  clerkUserId: 'user_avery',
  email: 'avery@example.test',
  displayName: 'Avery',
};

const newId = () => '01J8XKQ2M3N4P5R6S7T8V9W0XY';

/**
 * Session resolution, and the ways it is allowed to fail.
 *
 * Every test here is a denial. That is the point: an authentication boundary is defined by what
 * it refuses, and the failure worth guarding against is not "denies a valid session" — someone
 * notices that in a minute — but "admits a request whose identity it could not establish",
 * which nobody notices at all.
 */
describe('resolving a session', () => {
  it('returns nothing when nobody is signed in', async () => {
    const resolved = await resolveSession({ readIdentity: async () => null, newId });
    expect(resolved).toBeNull();
  });

  it('denies when Clerk throws rather than letting the request through', async () => {
    // Unreachable, clock skew, a malformed token. All of them mean we do not know who this is,
    // and "we do not know" is not "let them in".
    const onError = vi.fn();
    const resolved = await resolveSession({
      readIdentity: async () => {
        throw new Error('clerk unreachable');
      },
      newId,
      onError,
    });

    expect(resolved).toBeNull();
    // Denied, but never silently: a refusal nobody can explain afterwards is its own failure.
    expect(onError).toHaveBeenCalledOnce();
  });

  it('denies a session with no usable email', async () => {
    // Inventing a placeholder address would put a fabricated email in the audit log and on a
    // future invitation. Refusing is the closed answer.
    const onError = vi.fn();
    const resolved = await resolveSession({
      readIdentity: async () => ({ ...identity, email: '' }),
      newId,
      onError,
    });

    expect(resolved).toBeNull();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('does not touch the database before it has an identity', async () => {
    // If it did, an unauthenticated request would cost a connection — and a burst of them
    // would be a denial of service that needs no session at all. Asserted by watching the
    // handle, not by re-checking the return value the test above already covers.
    authDatabase.mockClear();
    provisionUser.mockClear();

    await resolveSession({ readIdentity: async () => null, newId });
    await resolveSession({ readIdentity: async () => ({ ...identity, email: '' }), newId });
    await resolveSession({
      readIdentity: async () => {
        throw new Error('clerk unreachable');
      },
      newId,
    });

    expect(authDatabase).not.toHaveBeenCalled();
    expect(provisionUser).not.toHaveBeenCalled();
  });

  it('builds a member subject once provisioning succeeds', async () => {
    provisionUser.mockResolvedValueOnce({ userId: 'USER_ROW_ID', created: true });

    const resolved = await resolveSession({ readIdentity: async () => identity, newId });

    expect(resolved?.userId).toBe('USER_ROW_ID');
    expect(resolved?.provisioned).toBe(true);
    // The shape `packages/authz` consumes. A subject of any other kind would be refused a
    // workspace handle by `scopedQuery`.
    expect(resolved?.subject).toEqual({ kind: 'member', userId: 'USER_ROW_ID' });
  });

  it('denies when the database refuses, rather than guessing at a subject', async () => {
    // The person may well be signed in. Without a `users` row there is no subject to
    // authorize, and a subject we cannot build is not one to invent.
    provisionUser.mockRejectedValueOnce(new Error('no connection'));
    const onError = vi.fn();

    const resolved = await resolveSession({ readIdentity: async () => identity, newId, onError });

    expect(resolved).toBeNull();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('reports the reader error rather than swallowing its type', async () => {
    const boom = new Error('specific failure');
    let seen: unknown;
    await resolveSession({
      readIdentity: async () => {
        throw boom;
      },
      newId,
      onError: (error) => {
        seen = error;
      },
    });
    expect(seen).toBe(boom);
  });
});
