/**
 * Turning what someone typed into the two shapes search runs (task `045`) — pure, so the escaping
 * is tested without a database.
 *
 * - An `ILIKE` pattern for names and titles, with `%`, `_`, and `\` escaped: typing `100%` finds
 *   "100% Real", not every name.
 * - A `to_tsquery('simple', …)` expression for lyrics built only from letter-and-digit tokens,
 *   each a prefix (`roa:*` finds "road" while it is still being typed). Nothing the person typed
 *   reaches the tsquery parser as syntax, so `!`, `|`, `(`, and `:` cannot change its meaning or
 *   make it throw.
 */

export const SEARCH_MAX_LENGTH = 200;
const MAX_TOKENS = 8;

export interface ParsedSearch {
  readonly text: string;
  readonly pattern: string;
  readonly tsquery: string | null;
}

export function parseSearch(raw: string): ParsedSearch | null {
  const text = raw.replace(/\s+/g, ' ').trim().slice(0, SEARCH_MAX_LENGTH);
  if (text === '') return null;
  const escaped = text.replace(/[\\%_]/g, (character) => `\\${character}`);
  const tokens = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, MAX_TOKENS);
  return {
    text,
    pattern: `%${escaped}%`,
    tsquery: tokens.length === 0 ? null : tokens.map((token) => `${token}:*`).join(' & '),
  };
}

/** A lyric snippet split into plain and matched runs — rendered as text, never as HTML. */
export function snippetRuns(
  snippet: string,
  start: string,
  stop: string,
): { readonly text: string; readonly match: boolean }[] {
  const runs: { text: string; match: boolean }[] = [];
  let rest = snippet.replace(/\s+/g, ' ');
  while (rest.length > 0) {
    const open = rest.indexOf(start);
    if (open === -1) {
      runs.push({ text: rest, match: false });
      break;
    }
    if (open > 0) runs.push({ text: rest.slice(0, open), match: false });
    const close = rest.indexOf(stop, open + 1);
    const end = close === -1 ? rest.length : close;
    runs.push({ text: rest.slice(open + 1, end), match: true });
    rest = close === -1 ? '' : rest.slice(close + 1);
  }
  return runs.filter((run) => run.text !== '');
}
