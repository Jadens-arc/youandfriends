import { describe, expect, it } from 'vitest';

import {
  AUTO_FLOOR_MINUTES,
  changeSize,
  lineDiff,
  LIFECYCLE_FLOOR_MINUTES,
  revisionsToThin,
  shouldSnapshot,
  type RevisionStamp,
} from '../revisions-policy';

const NOW = new Date('2026-09-24T12:00:00Z');
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

describe('lineDiff', () => {
  it('says which lines were kept, removed, and added, in order', () => {
    expect(lineDiff('[Verse]\na\nb\nc', '[Verse]\na\nB\nc\nd')).toEqual([
      { kind: 'same', text: '[Verse]' },
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'B' },
      { kind: 'same', text: 'c' },
      { kind: 'added', text: 'd' },
    ]);
  });

  it('handles empty sides', () => {
    expect(lineDiff('', 'x')).toEqual([{ kind: 'added', text: 'x' }]);
    expect(lineDiff('x', '')).toEqual([{ kind: 'removed', text: 'x' }]);
    expect(lineDiff('', '')).toEqual([]);
  });
});

describe('shouldSnapshot', () => {
  const last = (minutes: number, plainText: string) => ({
    createdAt: minutesAgo(minutes),
    plainText,
  });
  const verse = 'Verse\nHeadlights on the long road home\nNobody knows';

  it('keeps the first words ever saved, and never an empty sheet', () => {
    expect(shouldSnapshot({ last: null, plainText: verse, now: NOW, lifecycle: false })).toBe(true);
    expect(shouldSnapshot({ last: null, plainText: '  ', now: NOW, lifecycle: false })).toBe(false);
  });

  it('waits out the time floor however much changed', () => {
    const rewritten = 'Chorus\nSomething else entirely, a whole new chorus\nand another line';
    expect(
      shouldSnapshot({
        last: last(AUTO_FLOOR_MINUTES - 1, verse),
        plainText: rewritten,
        now: NOW,
        lifecycle: false,
      }),
    ).toBe(false);
    expect(
      shouldSnapshot({
        last: last(AUTO_FLOOR_MINUTES, verse),
        plainText: rewritten,
        now: NOW,
        lifecycle: false,
      }),
    ).toBe(true);
  });

  it('skips a typo fix, however long ago the last revision was', () => {
    const typo = verse.replace('Nobody', 'Nobdy');
    expect(changeSize(verse, typo).lines).toBe(2);
    expect(
      shouldSnapshot({ last: last(600, verse), plainText: typo, now: NOW, lifecycle: false }),
    ).toBe(false);
  });

  it('lets a page-hide save snapshot sooner, still only on a real change', () => {
    const more = `${verse}\nA third line, added before closing the tab, longer than a typo\nand a fourth line to go with it`;
    expect(
      shouldSnapshot({
        last: last(LIFECYCLE_FLOOR_MINUTES, verse),
        plainText: more,
        now: NOW,
        lifecycle: true,
      }),
    ).toBe(true);
    expect(
      shouldSnapshot({
        last: last(LIFECYCLE_FLOOR_MINUTES, verse),
        plainText: more,
        now: NOW,
        lifecycle: false,
      }),
    ).toBe(false);
  });
});

describe('revisionsToThin', () => {
  let n = 0;
  const rev = (kind: RevisionStamp['kind'], minutes: number): RevisionStamp => ({
    id: `r${(n += 1)}-${kind}-${minutes}`,
    kind,
    createdAt: minutesAgo(minutes),
  });

  it('keeps everything from today', () => {
    const today = [rev('automatic', 1), rev('automatic', 2), rev('automatic', 60 * 23)];
    expect(revisionsToThin(today, NOW)).toEqual([]);
  });

  it('keeps the latest automatic revision per hour for a week, per day after', () => {
    // Two in one hour, two days ago; two on one day, ten days ago.
    const hourA = rev('automatic', 60 * 48 + 10);
    const hourB = rev('automatic', 60 * 48 + 20);
    const dayA = rev('automatic', 60 * 24 * 10 + 60);
    const dayB = rev('automatic', 60 * 24 * 10 + 120);
    const thinned = revisionsToThin([hourA, hourB, dayA, dayB], NOW);
    expect(thinned.sort()).toEqual([hourB.id, dayB.id].sort());
  });

  it('never thins a checkpoint or a before-restore revision', () => {
    const old = [
      rev('checkpoint', 60 * 24 * 30),
      rev('checkpoint', 60 * 24 * 30 + 1),
      rev('before_restore', 60 * 24 * 30 + 2),
    ];
    expect(revisionsToThin(old, NOW)).toEqual([]);
  });
});
