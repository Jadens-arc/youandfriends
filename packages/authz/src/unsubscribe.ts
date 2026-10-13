import { createHmac, timingSafeEqual } from 'node:crypto';

import { isUlid, notificationEventSchema, type NotificationEvent } from '@youandfriends/contracts';

/**
 * Unsubscribe links (task `096`): signed, scoped, single-purpose.
 *
 * A token names one person, one workspace, and one event, and the only thing it can do is turn
 * **email** off for that event. It carries no role, no other setting, and nothing that changes
 * what anyone can open; the signature covers every field and a purpose string, so no part can be
 * edited and no token minted for anything else verifies here. It does not expire: a link in a
 * months-old email should still stop the emails, and what it can do is harmless to repeat.
 *
 * Shape: `<userId>.<workspaceId>.<event>.<signature>` — the event is dotted itself, so the
 * signature is everything after the last dot and the ids are the first two segments.
 */

const PURPOSE = 'youandfriends:unsubscribe-email:v1';

export interface UnsubscribeScope {
  readonly userId: string;
  readonly workspaceId: string;
  readonly event: NotificationEvent;
}

function sign(scope: UnsubscribeScope, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${PURPOSE}\n${scope.userId}\n${scope.workspaceId}\n${scope.event}`)
    .digest('base64url');
}

export function signUnsubscribe(scope: UnsubscribeScope, secret: string): string {
  if (secret.length < 32) throw new Error('the email signing secret is too short');
  return `${scope.userId}.${scope.workspaceId}.${scope.event}.${sign(scope, secret)}`;
}

/** The scope a token was signed for, or `null` for anything forged, altered, or malformed. */
export function verifyUnsubscribe(token: string, secret: string): UnsubscribeScope | null {
  if (secret.length < 32 || token.length > 300) return null;
  const parts = token.split('.');
  if (parts.length < 4) return null;
  const [userId = '', workspaceId = ''] = parts;
  const signature = parts.at(-1) ?? '';
  const event = notificationEventSchema.safeParse(parts.slice(2, -1).join('.'));
  if (!isUlid(userId) || !isUlid(workspaceId) || !event.success) return null;
  const scope = { userId, workspaceId, event: event.data };
  const expected = Buffer.from(sign(scope, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return scope;
}
