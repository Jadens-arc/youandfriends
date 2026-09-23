import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The accept-invitation route's own logic: what it does with no session, each `AcceptOutcome`
 * `acceptInvitationToken` can return, and that a successful acceptance sets the workspace
 * cookie before redirecting — never after, and never for anything but `'accepted'`. The
 * acceptance business logic itself is tested against a real database in
 * `lib/invitations/__tests__/accept.test.ts`; here the question is how the route responds.
 */

const session = vi.hoisted(() => ({ currentSession: vi.fn() }));
const database = vi.hoisted(() => ({ transactionalDatabase: vi.fn(() => ({})) }));
const accept = vi.hoisted(() => ({ acceptInvitationToken: vi.fn() }));
const cookieStore = vi.hoisted(() => ({ set: vi.fn() }));
const headersModule = vi.hoisted(() => ({ cookies: vi.fn(async () => cookieStore) }));
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
}));

vi.mock('@/lib/auth/current-session', () => session);
vi.mock('@/lib/database', () => database);
vi.mock('@/lib/invitations/accept', () => accept);
vi.mock('next/headers', () => headersModule);
vi.mock('next/navigation', () => navigation);

const { default: AcceptInvitationPage } = await import('../page');

const params = Promise.resolve({ token: 'yaf_invite_01ABC_secret' });

beforeEach(() => {
  vi.clearAllMocks();
  headersModule.cookies.mockResolvedValue(cookieStore);
  session.currentSession.mockResolvedValue({ userId: 'u2' });
});

describe('the accept-invitation route', () => {
  it('sends a signed-out visitor to sign in, before touching the token at all', async () => {
    session.currentSession.mockResolvedValue(null);
    await expect(AcceptInvitationPage({ params })).rejects.toThrow('NEXT_REDIRECT:/sign-in');
    expect(accept.acceptInvitationToken).not.toHaveBeenCalled();
  });

  it('accepts with the signed-in user’s id, sets the workspace cookie, and redirects home', async () => {
    accept.acceptInvitationToken.mockResolvedValue({
      kind: 'accepted',
      workspaceId: 'w9',
      scopeType: 'song',
      scopeId: 'song1',
    });

    await expect(AcceptInvitationPage({ params })).rejects.toThrow('NEXT_REDIRECT:/');

    expect(accept.acceptInvitationToken).toHaveBeenCalledWith(
      expect.objectContaining({ acceptingUserId: 'u2' }),
      'yaf_invite_01ABC_secret',
    );
    expect(cookieStore.set).toHaveBeenCalledWith(
      'yaf_workspace',
      'w9',
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
    // The cookie is set before the redirect throws, not raced against it.
    const setOrder = cookieStore.set.mock.invocationCallOrder[0];
    const redirectOrder = navigation.redirect.mock.invocationCallOrder[0];
    if (setOrder === undefined || redirectOrder === undefined) {
      throw new Error('expected both mocks to have been called');
    }
    expect(setOrder).toBeLessThan(redirectOrder);
  });

  it('never sets a cookie or redirects for a mismatched email — it renders the mismatch', async () => {
    accept.acceptInvitationToken.mockResolvedValue({
      kind: 'wrong_email',
      invitedEmail: 'sam@example.test',
    });

    const element = await AcceptInvitationPage({ params });

    expect(cookieStore.set).not.toHaveBeenCalled();
    expect(navigation.redirect).not.toHaveBeenCalled();
    expect(JSON.stringify(element)).toContain('sam@example.test');
  });

  it('never sets a cookie or redirects for a refused invitation — it renders the generic message', async () => {
    accept.acceptInvitationToken.mockResolvedValue({
      kind: 'refused',
      reason: 'This invitation is no longer valid.',
    });

    const element = await AcceptInvitationPage({ params });

    expect(cookieStore.set).not.toHaveBeenCalled();
    expect(navigation.redirect).not.toHaveBeenCalled();
    expect(JSON.stringify(element)).toContain('no longer valid');
  });
});
