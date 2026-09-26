import { MENTION_PATTERN } from '@youandfriends/contracts';

import type { MentionView } from './store';

/**
 * Mentions between the wire and the page (task `094`).
 *
 * On the wire a mention is `<@USERID>`; in the text box it is `@Name`, which is what people type
 * and read. The composer remembers which names were picked from the list, and only those become
 * references when the comment is sent — typing "@sam" by hand is just text.
 */

export type Segment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'mention'; readonly id: string; readonly name: string | null };

/**
 * A body as text and mentions. A reference to someone the comment did not reach — they could not
 * see the song — has no name here: showing it would tell every reader who else is around.
 */
export function segmentsOf(body: string, mentions: readonly MentionView[] = []): Segment[] {
  const names = new Map(mentions.map((person) => [person.id, person.name]));
  const segments: Segment[] = [];
  let last = 0;
  for (const match of body.matchAll(new RegExp(MENTION_PATTERN.source, 'g'))) {
    const id = match[1] ?? '';
    if (match.index > last) segments.push({ kind: 'text', text: body.slice(last, match.index) });
    segments.push({ kind: 'mention', id, name: names.get(id) ?? null });
    last = match.index + match[0].length;
  }
  if (last < body.length) segments.push({ kind: 'text', text: body.slice(last) });
  return segments;
}

/** A body as plain words — for a thread's name, a marker's excerpt, a notification. */
export function plainText(body: string, mentions: readonly MentionView[] = []): string {
  return segmentsOf(body, mentions)
    .map((segment) => (segment.kind === 'text' ? segment.text : `@${segment.name ?? 'someone'}`))
    .join('');
}

/** A stored body as the text box shows it, with the names already picked. */
export function toDisplay(
  body: string,
  mentions: readonly MentionView[] = [],
): { readonly text: string; readonly picked: Map<string, string> } {
  const picked = new Map<string, string>();
  const text = segmentsOf(body, mentions)
    .map((segment) => {
      if (segment.kind === 'text') return segment.text;
      // Unnamed references stay as they are, so an edit keeps them rather than dropping them.
      if (segment.name === null) return `<@${segment.id}>`;
      picked.set(segment.name, segment.id);
      return `@${segment.name}`;
    })
    .join('');
  return { text, picked };
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The text box's words for the wire: every picked `@Name` becomes its reference. */
export function toBody(text: string, picked: ReadonlyMap<string, string>): string {
  // Longest first, so "@Sam Rivera" is not taken as "@Sam" followed by " Rivera".
  const names = [...picked.keys()].sort((a, b) => b.length - a.length);
  if (names.length === 0) return text;
  const pattern = new RegExp(`@(${names.map(escape).join('|')})(?=$|[\\s.,!?;:)\\]'"’…-])`, 'gu');
  return text.replace(pattern, (whole, name: string) => {
    const id = picked.get(name);
    return id === undefined ? whole : `<@${id}>`;
  });
}

/** The `@partial name` the caret is in, if any: where it starts, and what has been typed. */
export function mentionQuery(
  text: string,
  caret: number,
): { readonly start: number; readonly query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([^\s@<>]{0,40})$/u.exec(before);
  if (match === null) return null;
  const query = match[2] ?? '';
  return { start: caret - query.length - 1, query };
}
