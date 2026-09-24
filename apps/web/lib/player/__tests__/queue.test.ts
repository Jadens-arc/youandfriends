import { describe, expect, it } from 'vitest';

import type { Track } from '../machine';
import {
  addNext,
  addToEnd,
  advance,
  buildQueue,
  currentOf,
  cycleRepeat,
  EMPTY_QUEUE,
  fromPersisted,
  hasNext,
  move,
  parsePersisted,
  removeAt,
  retreat,
  toggleShuffle,
  toPersisted,
  upcoming,
  type QueueState,
} from '../queue';

const track = (id: string): Track => ({
  versionId: id,
  songId: `S-${id}`,
  title: `Song ${id}`,
  artist: null,
  versionLabel: 'Version 1',
});
const [A, B, C, D, E] = ['A', 'B', 'C', 'D', 'E'].map(track) as [Track, Track, Track, Track, Track];
const ids = (queue: QueueState) => queue.order.map((index) => queue.items[index]?.versionId);

/** A predictable "random": always picks the lowest remaining index. */
const lowest = () => 0;

describe('the playback queue (task 073)', () => {
  it('builds from a list, starting where asked', () => {
    const queue = buildQueue(EMPTY_QUEUE, [A, B, C], 1);
    expect(currentOf(queue)).toBe(B);
    expect(upcoming(queue)).toEqual([C]);
  });

  it('adds next after the current track, and to the end', () => {
    let queue = buildQueue(EMPTY_QUEUE, [A, B, C]);
    queue = addNext(queue, [D]);
    expect(ids(queue)).toEqual(['A', 'D', 'B', 'C']);
    queue = addToEnd(queue, [E]);
    expect(ids(queue)).toEqual(['A', 'D', 'B', 'C', 'E']);
    expect(currentOf(queue)).toBe(A);
    // Onto an empty queue, either starts one.
    expect(currentOf(addToEnd(EMPTY_QUEUE, [C]))).toBe(C);
  });

  it('removes before, after, and the current track itself', () => {
    const queue = buildQueue(EMPTY_QUEUE, [A, B, C, D], 2);
    const before = removeAt(queue, 0);
    expect(ids(before)).toEqual(['B', 'C', 'D']);
    expect(currentOf(before)).toBe(C);
    const after = removeAt(queue, 3);
    expect(currentOf(after)).toBe(C);
    const current = removeAt(queue, 2);
    expect(currentOf(current)).toBe(D);
    const last = removeAt(buildQueue(EMPTY_QUEUE, [A, B], 1), 1);
    expect(currentOf(last)).toBe(A);
    expect(removeAt(buildQueue(EMPTY_QUEUE, [A]), 0)).toMatchObject({ items: [], position: -1 });
  });

  it('reorders, and the playing track follows its row', () => {
    const queue = buildQueue(EMPTY_QUEUE, [A, B, C, D], 1);
    const moved = move(queue, 1, 3);
    expect(ids(moved)).toEqual(['A', 'C', 'D', 'B']);
    expect(currentOf(moved)).toBe(B);
    expect(move(queue, 3, 0).position).toBe(2);
  });

  it('advances through the end with repeat off, all and one', () => {
    const queue = buildQueue(EMPTY_QUEUE, [A, B], 1);
    expect(advance(queue, 'auto')).toBeNull();
    expect(hasNext(queue)).toBe(false);
    const all = cycleRepeat(queue);
    expect(all.repeat).toBe('all');
    expect(currentOf(advance(all, 'auto') as QueueState)).toBe(A);
    const one = cycleRepeat(all);
    expect(one.repeat).toBe('one');
    // Repeat-one repeats on its own, but "next" still moves on.
    expect(advance(one, 'auto')?.position).toBe(1);
    expect(currentOf(advance(one, 'next') as QueueState)).toBe(A);
    expect(cycleRepeat(one).repeat).toBe('off');
  });

  it('goes back, wrapping only with repeat all', () => {
    const queue = buildQueue(EMPTY_QUEUE, [A, B, C], 0);
    expect(retreat(queue)).toBeNull();
    expect(currentOf(retreat(cycleRepeat(queue)) as QueueState)).toBe(C);
    expect(currentOf(retreat(buildQueue(EMPTY_QUEUE, [A, B, C], 2)) as QueueState)).toBe(B);
  });

  it('shuffles only what is still to come, and restores the listener’s order when turned off', () => {
    const queue = buildQueue(EMPTY_QUEUE, [A, B, C, D, E], 1);
    const shuffled = toggleShuffle(queue, () => 0.99);
    expect(shuffled.shuffle).toBe(true);
    expect(ids(shuffled).slice(0, 2)).toEqual(['A', 'B']);
    expect(new Set(ids(shuffled))).toEqual(new Set(['A', 'B', 'C', 'D', 'E']));
    expect(ids(toggleShuffle(queue, lowest)).slice(2)).not.toEqual(['C', 'D', 'E']);
    const restored = toggleShuffle(shuffled);
    expect(ids(restored)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(currentOf(restored)).toBe(B);
  });

  it('persists ids and positions only — never a URL or a title', () => {
    const queue = buildQueue(EMPTY_QUEUE, [
      { ...A, cover: { src: 'https://r2.example/signed?X-Amz-Signature=1', srcSet: '' } },
      B,
    ]);
    const persisted = JSON.stringify(toPersisted(queue));
    expect(persisted).not.toContain('https://');
    expect(persisted).not.toContain('Song A');
    expect(JSON.parse(persisted)).toEqual({
      versionIds: ['A', 'B'],
      order: [0, 1],
      position: 0,
      repeat: 'off',
      shuffle: false,
    });
  });

  it('restores only what the server still permits, resuming at what followed a dropped track', () => {
    const stored = toPersisted(buildQueue(EMPTY_QUEUE, [A, B, C, D], 1));
    // B (playing) and D were revoked.
    const restored = fromPersisted(stored, [A, C]);
    expect(ids(restored)).toEqual(['A', 'C']);
    expect(currentOf(restored)).toBe(C);
    expect(fromPersisted(stored, [])).toMatchObject({ items: [], position: -1 });
    // Everything after the current one gone: the last survivor.
    expect(currentOf(fromPersisted(toPersisted(buildQueue(EMPTY_QUEUE, [A, B], 1)), [A]))).toBe(A);
  });

  it('refuses stored junk, and replaces a stored order that is not a permutation', () => {
    expect(parsePersisted(null)).toBeNull();
    expect(parsePersisted({ versionIds: [1], order: [], position: 0 })).toBeNull();
    expect(parsePersisted({ versionIds: ['A'], order: ['x'], position: 0 })).toBeNull();
    const tampered = {
      versionIds: ['A', 'B'],
      order: [1, 1],
      position: 0,
      repeat: 'x',
      shuffle: 1,
    };
    const parsed = parsePersisted(tampered);
    expect(parsed).toMatchObject({ repeat: 'off', shuffle: false });
    expect(ids(fromPersisted(parsed!, [A, B]))).toEqual(['A', 'B']);
  });
});
