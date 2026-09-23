/**
 * Display formatting for the project library (task `041`). Pure, and given `now` explicitly:
 * the cards are rendered on the server, and a helper that read the clock itself would make the
 * same card say two different things in a test depending on when it ran.
 */

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const shortDate = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
const longDate = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "just now", "5 minutes ago", "yesterday", "4 days ago", then a plain date once a relative
 * phrase stops being easier to read than the date itself.
 */
export function formatRelative(date: Date, now: Date): string {
  const elapsed = now.getTime() - date.getTime();
  // A clock a little ahead of the server's is still "just now", not "in 2 seconds".
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return relative.format(-Math.floor(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return relative.format(-Math.floor(elapsed / HOUR), 'hour');
  if (elapsed < 7 * DAY) return relative.format(-Math.floor(elapsed / DAY), 'day');
  return date.getFullYear() === now.getFullYear() ? shortDate.format(date) : longDate.format(date);
}

export function formatSongCount(count: number): string {
  return count === 1 ? '1 song' : `${count} songs`;
}

/** Up to two initials, for an avatar or a cover placeholder. */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/u)
    .filter((word) => /[\p{L}\p{N}]/u.test(word));
  const letters = words.slice(0, 2).map((word) => [...word.replace(/^[^\p{L}\p{N}]+/u, '')][0]);
  return letters.join('').toLocaleUpperCase() || '·';
}

/**
 * A stable choice among `count` options for an id — the cover placeholder's tint. The same
 * project always gets the same tint, on every device, so a placeholder is recognizable.
 */
export function stableIndex(id: string, count: number): number {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  return hash % count;
}
