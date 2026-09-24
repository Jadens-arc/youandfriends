import type { Track } from './machine';

/**
 * The playback queue (task `073`), as a pure value: every operation takes a queue and returns a
 * new one. The controller in `store.ts` holds the current queue and plays what it says.
 *
 * `order` is the play order — the identity when shuffle is off, a permutation when it is on — so
 * shuffling never loses the listener's own arrangement, and turning it off restores it.
 */
export type RepeatMode = 'off' | 'all' | 'one';

export interface QueueState {
  readonly items: readonly Track[];
  /** Indexes into `items`, in the order they will play. */
  readonly order: readonly number[];
  /** Position in `order` of what is playing, or -1 for nothing. */
  readonly position: number;
  readonly repeat: RepeatMode;
  readonly shuffle: boolean;
}

export const EMPTY_QUEUE: QueueState = {
  items: [],
  order: [],
  position: -1,
  repeat: 'off',
  shuffle: false,
};

const identity = (length: number) => Array.from({ length }, (_, index) => index);

/** The track playing, per the queue. */
export function currentOf(queue: QueueState): Track | null {
  const index = queue.order[queue.position];
  return index === undefined ? null : (queue.items[index] ?? null);
}

/** What will play after the current track, in order. */
export function upcoming(queue: QueueState): Track[] {
  return queue.order
    .slice(queue.position + 1)
    .map((index) => queue.items[index])
    .filter((track): track is Track => track !== undefined);
}

/** A new queue from a list, starting at `startAt`, keeping the listener's repeat and shuffle. */
export function buildQueue(
  previous: QueueState,
  tracks: readonly Track[],
  startAt = 0,
  random: () => number = Math.random,
): QueueState {
  if (tracks.length === 0)
    return { ...EMPTY_QUEUE, repeat: previous.repeat, shuffle: previous.shuffle };
  const start = Math.min(Math.max(0, startAt), tracks.length - 1);
  const base: QueueState = {
    items: tracks,
    order: identity(tracks.length),
    position: start,
    repeat: previous.repeat,
    shuffle: false,
  };
  return previous.shuffle ? shuffleOn(base, random) : base;
}

/** Insert right after the current track. */
export function addNext(queue: QueueState, tracks: readonly Track[]): QueueState {
  if (tracks.length === 0) return queue;
  if (queue.items.length === 0) return buildQueue(queue, tracks);
  const firstNew = queue.items.length;
  const added = tracks.map((_, offset) => firstNew + offset);
  const order = [
    ...queue.order.slice(0, queue.position + 1),
    ...added,
    ...queue.order.slice(queue.position + 1),
  ];
  return { ...queue, items: [...queue.items, ...tracks], order };
}

/** Append at the end. */
export function addToEnd(queue: QueueState, tracks: readonly Track[]): QueueState {
  if (tracks.length === 0) return queue;
  if (queue.items.length === 0) return buildQueue(queue, tracks);
  const firstNew = queue.items.length;
  return {
    ...queue,
    items: [...queue.items, ...tracks],
    order: [...queue.order, ...tracks.map((_, offset) => firstNew + offset)],
  };
}

/** Remove the entry at `orderPosition`. Removing the playing track moves on to the next. */
export function removeAt(queue: QueueState, orderPosition: number): QueueState {
  const itemIndex = queue.order[orderPosition];
  if (itemIndex === undefined) return queue;
  const items = queue.items.filter((_, index) => index !== itemIndex);
  const order = queue.order
    .filter((_, position) => position !== orderPosition)
    .map((index) => (index > itemIndex ? index - 1 : index));
  if (items.length === 0) return { ...EMPTY_QUEUE, repeat: queue.repeat, shuffle: queue.shuffle };
  let position = queue.position;
  if (orderPosition < queue.position) position -= 1;
  if (position >= order.length) position = order.length - 1;
  return { ...queue, items, order, position };
}

/** Move the entry at `from` to `to` (both positions in play order). The playing track follows. */
export function move(queue: QueueState, from: number, to: number): QueueState {
  if (from === to || queue.order[from] === undefined) return queue;
  const target = Math.min(Math.max(0, to), queue.order.length - 1);
  const order = [...queue.order];
  const [moved] = order.splice(from, 1);
  order.splice(target, 0, moved as number);
  const playing = queue.order[queue.position];
  return { ...queue, order, position: playing === undefined ? -1 : order.indexOf(playing) };
}

/** Jump to the entry at `orderPosition`. */
export function jumpTo(queue: QueueState, orderPosition: number): QueueState {
  if (queue.order[orderPosition] === undefined) return queue;
  return { ...queue, position: orderPosition };
}

/**
 * The next position when a track ends (`auto`) or the listener presses next. Repeat-one repeats
 * only on its own (`auto`); pressing next still moves on. `null` is the end of the queue.
 */
export function advance(queue: QueueState, reason: 'auto' | 'next'): QueueState | null {
  if (queue.position < 0) return null;
  if (reason === 'auto' && queue.repeat === 'one') return queue;
  const next = queue.position + 1;
  if (next < queue.order.length) return { ...queue, position: next };
  if (queue.repeat === 'all' || (reason === 'next' && queue.repeat === 'one')) {
    return queue.order.length > 0 ? { ...queue, position: 0 } : null;
  }
  return null;
}

/** The previous position, wrapping only with repeat-all. `null` at the start. */
export function retreat(queue: QueueState): QueueState | null {
  if (queue.position > 0) return { ...queue, position: queue.position - 1 };
  if (queue.position === 0 && queue.repeat === 'all' && queue.order.length > 1) {
    return { ...queue, position: queue.order.length - 1 };
  }
  return null;
}

export function hasNext(queue: QueueState): boolean {
  return advance(queue, 'next') !== null;
}

export function cycleRepeat(queue: QueueState): QueueState {
  const next: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' };
  return { ...queue, repeat: next[queue.repeat] };
}

/** Shuffle what has not played yet; the playing track stays where it is. */
function shuffleOn(queue: QueueState, random: () => number): QueueState {
  const head = queue.order.slice(0, queue.position + 1);
  const rest = queue.order.slice(queue.position + 1);
  for (let index = rest.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [rest[index], rest[swap]] = [rest[swap] as number, rest[index] as number];
  }
  return { ...queue, order: [...head, ...rest], shuffle: true };
}

export function toggleShuffle(queue: QueueState, random: () => number = Math.random): QueueState {
  if (queue.shuffle) {
    // Back to the listener's own order, still on the same track.
    const playing = queue.order[queue.position];
    const order = identity(queue.items.length);
    return {
      ...queue,
      order,
      shuffle: false,
      position: playing === undefined ? -1 : order.indexOf(playing),
    };
  }
  return shuffleOn(queue, random);
}

/**
 * What is written to the browser's storage: version ids and positions, **never a stream URL**
 * (URLs expire and are credentials — `docs/THREAT_MODEL.md` T3), and nothing about a track
 * beyond its id. Titles are re-fetched on restore, through authorization.
 */
export interface PersistedQueue {
  readonly versionIds: readonly string[];
  readonly order: readonly number[];
  readonly position: number;
  readonly repeat: RepeatMode;
  readonly shuffle: boolean;
}

export function toPersisted(queue: QueueState): PersistedQueue {
  return {
    versionIds: queue.items.map((track) => track.versionId),
    order: queue.order,
    position: queue.position,
    repeat: queue.repeat,
    shuffle: queue.shuffle,
  };
}

/**
 * Rebuild a queue from what was stored and what the server says may still be played. Items the
 * server left out — revoked, deleted, no longer streamable — are dropped, and the order and
 * position are carried over to what remains.
 */
export function fromPersisted(stored: PersistedQueue, permitted: readonly Track[]): QueueState {
  const byId = new Map(permitted.map((track) => [track.versionId, track]));
  const keptIndexes = new Map<number, number>();
  const items: Track[] = [];
  stored.versionIds.forEach((id, index) => {
    const track = byId.get(id);
    if (track === undefined) return;
    keptIndexes.set(index, items.length);
    items.push(track);
  });
  if (items.length === 0) {
    return { ...EMPTY_QUEUE, repeat: stored.repeat, shuffle: stored.shuffle };
  }
  // Anything but a permutation of the stored items is someone else's idea of an order.
  const count = stored.versionIds.length;
  const isPermutation =
    stored.order.length === count &&
    [...stored.order].sort((a, b) => a - b).every((value, index) => value === index);
  const validOrder = isPermutation ? stored.order : identity(count);
  const order: number[] = [];
  let position = -1;
  validOrder.forEach((index, orderPosition) => {
    const kept = keptIndexes.get(index);
    if (kept === undefined) return;
    // The current track if it survived; if it was dropped, whatever followed it.
    if (position === -1 && orderPosition >= stored.position) position = order.length;
    order.push(kept);
  });
  if (position === -1) position = order.length - 1;
  return { items, order, position, repeat: stored.repeat, shuffle: stored.shuffle };
}

export function parsePersisted(raw: unknown): PersistedQueue | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const ids = value.versionIds;
  const order = value.order;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) return null;
  if (!Array.isArray(order) || !order.every((index) => Number.isInteger(index))) return null;
  if (typeof value.position !== 'number') return null;
  const repeat = value.repeat === 'all' || value.repeat === 'one' ? value.repeat : 'off';
  return {
    versionIds: ids as string[],
    order: order as number[],
    position: value.position,
    repeat,
    shuffle: value.shuffle === true,
  };
}
