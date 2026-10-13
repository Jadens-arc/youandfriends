import { MENTION_PATTERN } from '@youandfriends/contracts';

/**
 * Between what a person types and what is stored (task `094`). The composer shows `@Name`; the
 * server stores `<@userId>`, so a rename never orphans a mention. A name only becomes a mention
 * when it was picked from the list — typing `@Sam` by hand mentions nobody.
 */

export interface Person {
  readonly userId: string;
  readonly displayName: string;
}

/** Stored words to what the composer shows: each token becomes `@Name`. */
export function toEditable(body: string, people: readonly Person[]): string {
  const names = new Map(people.map((person) => [person.userId, person.displayName]));
  return body.replace(MENTION_PATTERN, (_, userId: string) => `@${names.get(userId) ?? 'someone'}`);
}

/**
 * What the composer shows to stored words: every `@Name` that names someone picked becomes their
 * token. Longest names first, so `@Sam Lee` is not taken as `@Sam` followed by "Lee".
 */
export function toStored(text: string, picked: readonly Person[]): string {
  const byName = [...new Map(picked.map((person) => [person.displayName, person])).values()].sort(
    (a, b) => b.displayName.length - a.displayName.length,
  );
  let out = text;
  for (const person of byName) {
    out = out.split(`@${person.displayName}`).join(`<@${person.userId}>`);
  }
  return out;
}

/** The `@query` being typed at the caret, if there is one. */
export function activeQuery(
  text: string,
  caret: number,
): { readonly start: number; readonly query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([^\s@<>]{0,30})$/.exec(before);
  if (match === null) return null;
  const query = match[2] ?? '';
  return { start: caret - query.length - 1, query };
}

export type Segment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'mention'; readonly userId: string };

/** Stored words split into plain text and mentions, for rendering. */
export function segments(body: string): Segment[] {
  const parts: Segment[] = [];
  let last = 0;
  for (const match of body.matchAll(MENTION_PATTERN)) {
    const at = match.index;
    if (at > last) parts.push({ kind: 'text', text: body.slice(last, at) });
    parts.push({ kind: 'mention', userId: match[1] ?? '' });
    last = at + match[0].length;
  }
  if (last < body.length) parts.push({ kind: 'text', text: body.slice(last) });
  return parts;
}
