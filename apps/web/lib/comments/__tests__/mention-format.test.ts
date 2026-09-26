import { mentionedUserIds } from '@youandfriends/contracts';
import { describe, expect, it } from 'vitest';

import { mentionQuery, plainText, segmentsOf, toBody, toDisplay } from '../mention-format';

const id = (tag: string) => `01HZX${tag}`.padEnd(26, '0');
const SAM = id('SAM');
const SAMR = id('SAMR');
const GHOST = id('GHST');

describe('mentions between the wire and the page (task 094)', () => {
  it('writes picked names as references — longest first — and leaves typed ones as text', () => {
    const picked = new Map([
      ['Sam', SAM],
      ['Sam Rivera', SAMR],
    ]);
    expect(toBody('@Sam Rivera and @Sam, and @sam and @Samuel', picked)).toBe(
      `<@${SAMR}> and <@${SAM}>, and @sam and @Samuel`,
    );
    expect(mentionedUserIds(toBody('@Sam @Sam', picked))).toEqual([SAM]);
  });

  it('round-trips a stored body through the text box, keeping unnamed references', () => {
    const body = `<@${SAM}> have a listen — cc <@${GHOST}>`;
    const { text, picked } = toDisplay(body, [{ id: SAM, name: 'Sam' }]);
    expect(text).toBe(`@Sam have a listen — cc <@${GHOST}>`);
    expect(toBody(text, picked)).toBe(body);
  });

  it('shows the current name, and "someone" for a reference that reached no one', () => {
    const body = `<@${SAM}> and <@${GHOST}>?`;
    expect(segmentsOf(body, [{ id: SAM, name: 'Samantha' }])).toEqual([
      { kind: 'mention', id: SAM, name: 'Samantha' },
      { kind: 'text', text: ' and ' },
      { kind: 'mention', id: GHOST, name: null },
      { kind: 'text', text: '?' },
    ]);
    expect(plainText(body, [{ id: SAM, name: 'Samantha' }])).toBe('@Samantha and @someone?');
  });

  it('finds the @name being typed at the caret, and only there', () => {
    expect(mentionQuery('hey @sa', 7)).toEqual({ start: 4, query: 'sa' });
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQuery('mail me@example', 15)).toBeNull();
    expect(mentionQuery('hey @sam there', 14)).toBeNull();
  });
});
