import type * as ReactModule from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The request glue: Clerk session in, cookie read, workspace out — and closed on every failure.
 * Resolution itself is tested against a real database in `resolve.test.ts`.
 */

const session = vi.hoisted(() => ({ currentSession: vi.fn() }));
const resolve = vi.hoisted(() => ({
  resolveWorkspace: vi.fn(),
  WORKSPACE_COOKIE: 'yaf_workspace',
}));
const cookieJar = vi.hoisted(() => new Map<string, string>());
const headerJar = vi.hoisted(() => new Map<string, string>());

vi.mock('server-only', () => ({}));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactModule>()),
  // `cache` memoizes per request in React's server runtime; outside it, a pass-through is the
  // honest equivalent for one call.
  cache: <T>(fn: T) => fn,
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined),
  }),
  headers: async () => ({ get: (name: string) => headerJar.get(name) ?? null }),
}));
vi.mock('@/lib/auth/current-session', () => session);
vi.mock('@/lib/database', () => ({ transactionalDatabase: () => 'direct-db' }));
vi.mock('../resolve', () => resolve);

const { currentWorkspace, workspaceRequest } = await import('../current');

const SESSION = {
  subject: { kind: 'member', userId: 'u1' },
  userId: 'u1',
  clerkUserId: 'user_1',
  displayName: 'Avery',
  provisioned: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.clear();
  headerJar.clear();
});

describe('the current workspace', () => {
  it('is nothing for someone not signed in, and resolves nothing', async () => {
    session.currentSession.mockResolvedValue(null);
    expect(await currentWorkspace()).toBeNull();
    expect(resolve.resolveWorkspace).not.toHaveBeenCalled();
  });

  it('passes the cookie on as a request, and the platform request id as the correlation id', async () => {
    session.currentSession.mockResolvedValue(SESSION);
    cookieJar.set('yaf_workspace', 'W2');
    headerJar.set('x-vercel-id', 'iad1::abc');
    const workspace = { workspaceId: 'W2', name: 'Two', role: 'editor' };
    resolve.resolveWorkspace.mockResolvedValue(workspace);

    const context = await currentWorkspace();

    expect(resolve.resolveWorkspace).toHaveBeenCalledWith('direct-db', {
      userId: 'u1',
      displayName: 'Avery',
      requested: 'W2',
      correlationId: 'iad1::abc',
    });
    expect(context).toEqual({
      subject: SESSION.subject,
      userId: 'u1',
      workspace,
      correlationId: 'iad1::abc',
    });
  });

  it('asks for no workspace in particular when there is no cookie', async () => {
    session.currentSession.mockResolvedValue(SESSION);
    resolve.resolveWorkspace.mockResolvedValue(null);

    expect(await currentWorkspace()).toBeNull();
    expect(resolve.resolveWorkspace.mock.calls[0]?.[1]).toMatchObject({ requested: null });
  });

  it('fails closed, and loudly, when resolution throws', async () => {
    session.currentSession.mockResolvedValue(SESSION);
    resolve.resolveWorkspace.mockRejectedValue(new Error('database unreachable'));
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    expect(await currentWorkspace()).toBeNull();
    expect(stderr.mock.calls.map(([line]) => String(line)).join('')).toContain(
      'workspace resolution failed',
    );
    stderr.mockRestore();
  });

  it('builds the use-case request from the context, never from anything the client sent', () => {
    const request = workspaceRequest({
      subject: SESSION.subject as never,
      userId: 'u1',
      workspace: { workspaceId: 'W1' as never, name: 'One', role: 'owner' },
      correlationId: 'c',
    });
    expect(request).toEqual({
      db: 'direct-db',
      subject: SESSION.subject,
      workspaceId: 'W1',
      correlationId: 'c',
    });
  });
});
