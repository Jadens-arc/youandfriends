import { createHmac, timingSafeEqual } from 'node:crypto';

import { isUlid, NOTIFICATION_EVENTS, type NotificationEvent } from '@youandfriends/contracts';

/**
 * Unsubscribe links (task `096`).
 *
 * An email may sit in an inbox forever and be forwarded anywhere, so the link in it can do **one
 * thing**: switch off email for one event — or, from a digest, all email — for the one person it
 * was sent to. The token names only that: a purpose, a person, and a scope. It cannot name a
 * channel, a setting, a value, or anyone else, so there is nothing in it to manipulate into
 * changing something else. The HMAC is over the purpose too, so no other signed value of ours can
 * be replayed as one.
 *
 * No expiry: an unsubscribe link that stops working is a reason to mark mail as spam. Replaying it
 * only switches off again what it already switched off.
 */

const PURPOSE = 'unsubscribe-email/v1';

export type UnsubscribeScope = NotificationEvent | 'all';

export interface Unsubscribe {
  readonly userId: string;
  readonly scope: UnsubscribeScope;
}

const encode = (value: string | Buffer) => Buffer.from(value).toString('base64url');

function mac(secret: string, body: string): Buffer {
  return createHmac('sha256', secret).update(`${PURPOSE}\n${body}`).digest();
}

export function signUnsubscribe(secret: string, unsubscribe: Unsubscribe): string {
  const body = encode(JSON.stringify({ u: unsubscribe.userId, s: unsubscribe.scope }));
  return `${body}.${encode(mac(secret, body))}`;
}

/** The unsubscribe a token carries, or null for anything forged, altered, or malformed. */
export function verifyUnsubscribe(secret: string, token: string): Unsubscribe | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body = '', signature = ''] = parts;
  const expected = mac(secret, body);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { u, s } = parsed as { u?: unknown; s?: unknown };
  if (typeof u !== 'string' || !isUlid(u)) return null;
  if (s !== 'all' && !(NOTIFICATION_EVENTS as readonly unknown[]).includes(s)) return null;
  return { userId: u, scope: s as UnsubscribeScope };
}
