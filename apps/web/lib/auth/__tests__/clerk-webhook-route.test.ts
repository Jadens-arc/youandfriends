import { createHmac } from 'node:crypto';

import { webhookSigningSecret } from '@youandfriends/config/fixtures';
import { auditEvents, type DirectDatabase } from '@youandfriends/db';
import {
  createTestDatabase,
  makeTenant,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as ProvisionModule from '@/lib/auth/provision';

/**
 * The webhook endpoint (`app/api/webhooks/clerk/route.ts`), with Clerk's real verifier and
 * genuinely signed deliveries. Kept here rather than beside the route so the route directory's
 * rule — no database import without the authorizer — stays unconditional.
 *
 * Only the database handles are substituted — they point at a scratch database instead of the
 * configured one. The signature check is the real `verifyWebhook`, fed deliveries signed exactly
 * as Svix signs them, because a stubbed verifier would make every test here pass against a
 * route that accepted anything (CLAUDE.md §7).
 */

const database = vi.hoisted(() => ({ current: null as DirectDatabase | null }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/database', () => ({
  transactionalDatabase: () => database.current,
}));
vi.mock('@/lib/auth/provision', async (importOriginal) => ({
  ...(await importOriginal<typeof ProvisionModule>()),
  authDatabase: () => database.current,
}));

const { POST } = await import('@/app/api/webhooks/clerk/route');

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING Clerk webhook route tests: ${reason}`);

/** Sign a body the way Svix does: HMAC-SHA256 over `id.timestamp.body`, base64, `v1,` prefix. */
function signed(
  body: string,
  options: { secret?: string; id?: string; timestamp?: number } = {},
): NextRequest {
  const secret = options.secret ?? webhookSigningSecret;
  const id = options.id ?? `msg_${Math.random().toString(36).slice(2)}`;
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');

  return new NextRequest('https://youandfriends.org/api/webhooks/clerk', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'svix-id': id,
      'svix-timestamp': String(timestamp),
      'svix-signature': `v1,${signature}`,
    },
    body,
  });
}

const sessionEvent = (type: string, clerkUserId: string, sessionId: string) =>
  JSON.stringify({
    type,
    object: 'event',
    data: { id: sessionId, user_id: clerkUserId, actor: null, user: null },
    event_attributes: { http_request: { client_ip: '', user_agent: '' } },
  });

describe('the Clerk webhook, unconfigured', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuses with 503 rather than acknowledging events into nothing', async () => {
    vi.stubEnv('CLERK_WEBHOOK_SECRET', undefined);
    const response = await POST(signed(sessionEvent('session.created', 'user_x', 'sess_x')));
    // Not 200: an acknowledged event is never redelivered, so sign-ins during the misconfiguration
    // would be lost for good. 503 makes Clerk retry until the secret is set.
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('300');
  });
});

describeWithDatabase('the Clerk webhook', () => {
  let test: TestDatabase;

  beforeAll(async () => {
    test = await createTestDatabase('web_clerk_webhook');
    database.current = test.db;
    vi.stubEnv('CLERK_WEBHOOK_SECRET', webhookSigningSecret);
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await test?.teardown();
  });

  const eventsIn = (workspaceId: string) =>
    test.db.select().from(auditEvents).where(eq(auditEvents.workspaceId, workspaceId));

  it('records a correctly signed sign-in', async () => {
    const { user, workspace } = await makeTenant(test.db);

    const response = await POST(
      signed(sessionEvent('session.created', user.clerkUserId, 'sess_ok'), { id: 'msg_ok' }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'recorded' });
    const [row] = await eventsIn(workspace.id);
    expect(row).toMatchObject({ action: 'auth.signed_in', correlationId: 'msg_ok' });
  });

  it('refuses a delivery signed with another secret, and records nothing', async () => {
    const { user, workspace } = await makeTenant(test.db);
    const forged = ['whsec', Buffer.from('someone-elses-key').toString('base64')].join('_');

    const response = await POST(
      signed(sessionEvent('session.created', user.clerkUserId, 'sess_forged'), { secret: forged }),
    );

    expect(response.status).toBe(400);
    expect(await eventsIn(workspace.id)).toHaveLength(0);
  });

  it('refuses a body altered after signing', async () => {
    const { user, workspace } = await makeTenant(test.db);
    const request = signed(sessionEvent('session.ended', user.clerkUserId, 'sess_a'));
    const tampered = new NextRequest(request.url, {
      method: 'POST',
      headers: request.headers,
      body: sessionEvent('session.revoked', user.clerkUserId, 'sess_a'),
    });

    expect((await POST(tampered)).status).toBe(400);
    expect(await eventsIn(workspace.id)).toHaveLength(0);
  });

  it('refuses a genuine delivery replayed long after it was signed', async () => {
    const { user, workspace } = await makeTenant(test.db);
    const anHourAgo = Math.floor(Date.now() / 1000) - 60 * 60;

    const response = await POST(
      signed(sessionEvent('session.created', user.clerkUserId, 'sess_old'), {
        timestamp: anHourAgo,
      }),
    );

    expect(response.status).toBe(400);
    expect(await eventsIn(workspace.id)).toHaveLength(0);
  });

  it('refuses an unsigned delivery', async () => {
    const response = await POST(
      new NextRequest('https://youandfriends.org/api/webhooks/clerk', {
        method: 'POST',
        body: sessionEvent('session.created', 'user_x', 'sess_unsigned'),
      }),
    );
    expect(response.status).toBe(400);
  });

  it('acknowledges events it does not handle, so Clerk stops retrying them', async () => {
    const response = await POST(
      signed(JSON.stringify({ type: 'user.updated', object: 'event', data: { id: 'user_x' } })),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'ignored' });
  });

  it('reports failure with 500 so the delivery is retried', async () => {
    const { user } = await makeTenant(test.db);
    const working = database.current;
    database.current = {
      ...test.db,
      select: () => {
        throw new Error('database unreachable');
      },
    } as unknown as DirectDatabase;

    try {
      const response = await POST(
        signed(sessionEvent('session.created', user.clerkUserId, 'sess_fail')),
      );
      expect(response.status).toBe(500);
    } finally {
      database.current = working;
    }
  });
});
