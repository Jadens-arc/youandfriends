import { describe, expect, it } from 'vitest';

import { signUnsubscribe, verifyUnsubscribe } from './unsubscribe';

const SECRET = ['test', 'signing', 'secret', 'that', 'is', 'long', 'enough'].join('-');
const OTHER = ['another', 'signing', 'secret', 'long', 'enough', 'too'].join('-');
const USER = '01J9ZZZZZZZZZZZZZZZZZZZZZA';
const OTHER_USER = '01J9ZZZZZZZZZZZZZZZZZZZZZB';
const WORKSPACE = '01J9ZZZZZZZZZZZZZZZZZZZZZC';

describe('unsubscribe links (task 096)', () => {
  const scope = { userId: USER, workspaceId: WORKSPACE, event: 'comment.mentioned' as const };

  it('round-trips the one scope it was signed for', () => {
    expect(verifyUnsubscribe(signUnsubscribe(scope, SECRET), SECRET)).toEqual(scope);
  });

  it('refuses a token whose person, workspace, or event was edited', () => {
    const token = signUnsubscribe(scope, SECRET);
    const signature = token.split('.').at(-1);
    for (const forged of [
      `${OTHER_USER}.${WORKSPACE}.comment.mentioned.${signature}`,
      `${USER}.${OTHER_USER}.comment.mentioned.${signature}`,
      `${USER}.${WORKSPACE}.access.changed.${signature}`,
      `${USER}.${WORKSPACE}.comment.mentioned.${signature}x`,
      `${USER}.${WORKSPACE}.not.an.event.${signature}`,
      'garbage',
    ]) {
      expect(verifyUnsubscribe(forged, SECRET)).toBeNull();
    }
  });

  it('refuses a token signed with another key', () => {
    expect(verifyUnsubscribe(signUnsubscribe(scope, OTHER), SECRET)).toBeNull();
  });
});
