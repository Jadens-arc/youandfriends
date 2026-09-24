/**
 * The rules behind lyric revisions (task `084`) — pure, so each is tested on its own.
 */

/** At most one automatic revision per this many minutes of saving. */
export const AUTO_FLOOR_MINUTES = 10;
/** Leaving the page (a lifecycle save) may snapshot sooner — the session is ending. */
export const LIFECYCLE_FLOOR_MINUTES = 2;
/** A change is meaningful at this many lines touched (a rewritten line touches two)… */
export const MEANINGFUL_LINES = 4;
/** …or this many characters across the lines touched. */
export const MEANINGFUL_CHARACTERS = 80;

export type DiffKind = 'same' | 'added' | 'removed';

export interface DiffLine {
  readonly kind: DiffKind;
  readonly text: string;
}

/** Lines too long to compare cheaply are compared as one block. */
const MAX_DIFF_LINES = 4_000;

/**
 * A line diff (longest common subsequence) from `before` to `after`. Line-based on purpose: a
 * character-level diff of a lyric sheet is unreadable, while "this line became that line" is how
 * people talk about drafts.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before === '' ? [] : before.split('\n');
  const b = after === '' ? [] : after.split('\n');
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    return [
      ...a.map((text) => ({ kind: 'removed' as const, text })),
      ...b.map((text) => ({ kind: 'added' as const, text })),
    ];
  }
  // lengths[i][j]: LCS of a[i..] and b[j..].
  const lengths: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const row = lengths[i] as number[];
      row[j] =
        a[i] === b[j]
          ? (lengths[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(lengths[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] as string });
      i += 1;
      j += 1;
    } else if ((lengths[i + 1]?.[j] ?? 0) >= (lengths[i]?.[j + 1] ?? 0)) {
      out.push({ kind: 'removed', text: a[i] as string });
      i += 1;
    } else {
      out.push({ kind: 'added', text: b[j] as string });
      j += 1;
    }
  }
  while (i < a.length) out.push({ kind: 'removed', text: a[(i += 1) - 1] as string });
  while (j < b.length) out.push({ kind: 'added', text: b[(j += 1) - 1] as string });
  return out;
}

/** How much changed between two plain-text projections: lines touched, characters in them. */
export function changeSize(before: string, after: string): { lines: number; characters: number } {
  let lines = 0;
  let characters = 0;
  for (const line of lineDiff(before, after)) {
    if (line.kind === 'same') continue;
    lines += 1;
    characters += line.text.length;
  }
  return { lines, characters };
}

/**
 * Whether a save should also leave an automatic revision: the lyrics changed meaningfully since
 * the last revision of any kind, and the time floor has passed. The first words ever saved are
 * always kept.
 */
export function shouldSnapshot(input: {
  readonly last: { readonly createdAt: Date; readonly plainText: string } | null;
  readonly plainText: string;
  readonly now: Date;
  readonly lifecycle: boolean;
}): boolean {
  if (input.plainText.trim() === '') return false;
  if (input.last === null) return true;
  const floor = (input.lifecycle ? LIFECYCLE_FLOOR_MINUTES : AUTO_FLOOR_MINUTES) * 60_000;
  if (input.now.getTime() - input.last.createdAt.getTime() < floor) return false;
  const size = changeSize(input.last.plainText, input.plainText);
  return size.lines >= MEANINGFUL_LINES || size.characters >= MEANINGFUL_CHARACTERS;
}

export interface RevisionStamp {
  readonly id: string;
  readonly kind: 'automatic' | 'checkpoint' | 'before_restore';
  readonly createdAt: Date;
}

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/**
 * Retention (shown to people in the history panel): checkpoints and before-restore revisions are
 * kept indefinitely; automatic ones are all kept for a day, then the latest of each hour for a
 * week, then the latest of each day. Returns the automatic revisions to remove.
 */
export function revisionsToThin(revisions: readonly RevisionStamp[], now: Date): string[] {
  const keepers = new Map<string, RevisionStamp>();
  const remove: string[] = [];
  const newestFirst = [...revisions].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  for (const revision of newestFirst) {
    if (revision.kind !== 'automatic') continue;
    const age = now.getTime() - revision.createdAt.getTime();
    if (age < DAY) continue;
    const bucket =
      age < 7 * DAY
        ? `h:${Math.floor(revision.createdAt.getTime() / HOUR)}`
        : `d:${Math.floor(revision.createdAt.getTime() / DAY)}`;
    if (keepers.has(bucket)) remove.push(revision.id);
    else keepers.set(bucket, revision);
  }
  return remove;
}

export const RETENTION_POLICY_TEXT =
  'Named checkpoints, and the draft saved before each restore, are kept for as long as the song is. ' +
  'Automatic snapshots are all kept for a day, then one an hour for a week, then one a day.';
