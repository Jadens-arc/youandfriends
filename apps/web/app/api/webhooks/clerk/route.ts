import { verifyWebhook } from '@clerk/nextjs/webhooks';
import { loggerForEnv, parseServerEnv } from '@youandfriends/config';
import type { NextRequest } from 'next/server';

import { authDatabase } from '@/lib/auth/provision';
import { recordSessionEvent } from '@/lib/auth/session-events';
import { transactionalDatabase } from '@/lib/database';

/**
 * Clerk's session webhooks: the only way this server learns that someone signed out, or that a
 * session was revoked (`lib/auth/session-events.ts`).
 *
 * **Public, and authenticated by signature instead.** The proxy lets `/api/webhooks` through
 * without a session, because Clerk is the caller and has no session to present. What stands in
 * for one is the Svix signature over the body, checked with `CLERK_WEBHOOK_SECRET` before a
 * single byte is parsed as an event. The signed timestamp is checked too, so a captured
 * delivery cannot be replayed later.
 *
 * Status codes are for Clerk's retry logic, and each is chosen for what it causes:
 *   - 503 when unconfigured — honest, and retried, so events are delivered once the secret is
 *     set rather than acknowledged into nothing;
 *   - 400 when the signature fails — not ours, and nothing to retry;
 *   - 500 when recording fails — retried, which is safe because recording is idempotent;
 *   - 200 otherwise, including events this endpoint ignores, which would otherwise be retried
 *     forever.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const env = parseServerEnv();
  const log = loggerForEnv(env);

  const signingSecret = env.CLERK_WEBHOOK_SECRET;
  if (signingSecret === undefined) {
    log.error('clerk webhook received but CLERK_WEBHOOK_SECRET is not set');
    return new Response('Webhook signing secret is not configured.\n', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '300' },
    });
  }

  let event: unknown;
  try {
    event = await verifyWebhook(request, { signingSecret });
  } catch (error) {
    // Logged without the body or headers: an unverified request is attacker-controlled input,
    // and the signature header is exactly the kind of thing the redaction list exists for.
    log.warn('clerk webhook signature rejected', { error });
    return new Response(null, { status: 400 });
  }

  // Svix's delivery id: stable across retries of one message, so it joins every row it wrote.
  const deliveryId = request.headers.get('svix-id') ?? undefined;

  try {
    const outcome = await recordSessionEvent(
      { db: transactionalDatabase(), users: authDatabase() },
      event,
      deliveryId,
    );
    if (outcome.kind === 'unattributable') {
      log.warn('clerk session event not attributable to a workspace', {
        reason: outcome.reason,
        deliveryId,
      });
    }
    return Response.json({ outcome: outcome.kind });
  } catch (error) {
    log.error('clerk session event could not be recorded', { error, deliveryId });
    return new Response(null, { status: 500 });
  }
}
