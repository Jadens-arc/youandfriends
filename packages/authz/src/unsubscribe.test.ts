import { createHmac } from 'node:crypto';

import { newUlid } from '@youandfriends/contracts';
import { describe, expect, it } from 'vitest';

import { signUnsubscribe, verifyUnsubscribe } from './unsubscribe';

const secret = ['unsub', 'test', 'EXAMPLENOTAREALSECRETVALUE0000'].join('_');
const other = ['unsub', 'other', 'EXAMPLENOTAREALSECRETVALUE0000'].join('_');

describe('unsubscribe links (task 096)', () => {
  const userId = newUlid();

  it('round-trips one person and one scope', () => {
    const token = signUnsubscribe(secret, { userId, scope: 'comment.created' });
    expect(verifyUnsubscribe(secret, token)).toEqual({ userId, scope: 'comment.created' });
    expect(verifyUnsubscribe(secret, signUnsubscribe(secret, { userId, scope: 'all' }))).toEqual({
      userId,
      scope: 'all',
    });
  });

  it('refuses a token signed with another secret, or altered in any part', () => {
    const token = signUnsubscribe(secret, { userId, scope: 'comment.created' });
    expect(verifyUnsubscribe(other, token)).toBeNull();
    const [body = '', signature = ''] = token.split('.');
    // Someone else, or a wider scope, under the original signature.
    for (const payload of [
      { u: newUlid(), s: 'comment.created' },
      { u: userId, s: 'all' },
      { u: userId, s: 'comment.created', channel: 'in_app', enabled: true },
    ]) {
      const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`;
      expect(verifyUnsubscribe(secret, forged)).toBeNull();
    }
    expect(verifyUnsubscribe(secret, `${body}.${signature.slice(0, -2)}AA`)).toBeNull();
    expect(verifyUnsubscribe(secret, body)).toBeNull();
    expect(verifyUnsubscribe(secret, `${token}.extra`)).toBeNull();
  });

  it('refuses a validly signed payload that names nothing it can do', () => {
    // Signed, but not for anything unsubscribe knows: an unknown scope, a user that is not an id.
    const craft = (payload: unknown) => {
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
      // Signed the only way possible: with the real key, as only a test can.
      const mac = createHmac('sha256', secret)
        .update(`unsubscribe-email/v1\n${body}`)
        .digest('base64url');
      return `${body}.${mac}`;
    };
    expect(verifyUnsubscribe(secret, craft({ u: userId, s: 'in_app' }))).toBeNull();
    expect(verifyUnsubscribe(secret, craft({ u: 'someone', s: 'all' }))).toBeNull();
    expect(verifyUnsubscribe(secret, craft(['not', 'an', 'object']))).toBeNull();
    expect(verifyUnsubscribe(secret, craft({ u: userId, s: 'comment.created' }))).toEqual({
      userId,
      scope: 'comment.created',
    });
  });
});
