import { createHash } from 'node:crypto';

/**
 * Deterministic identifiers, so the seed is idempotent.
 *
 * Every seeded row's id is derived from a stable label. Re-running produces the same ids, so
 * an upsert updates rather than duplicates — and a developer who re-runs the seed after a
 * schema change does not need to reset first. A seed that duplicates on second run teaches
 * people to reset reflexively, and resetting reflexively is how someone eventually resets the
 * wrong database.
 */

const CROCKFORD = ['0123456789', 'ABCDEFGHJKMN', 'PQRSTVWXYZ'].join('');

/** The namespace every seeded id derives from, so `--reset` can recognise its own work. */
export const SEED_NAMESPACE = 'youandfriends.seed.v1';

/**
 * A ULID-shaped id for a label. Same label, same id, always.
 *
 * Not a real ULID: there is no timestamp, because a seeded row's creation order is not
 * meaningful and a time prefix would change between runs, which is the one thing this must not
 * do. It satisfies the 26-character Crockford shape the contracts validate.
 */
export function deterministicId(label: string): string {
  const digest = createHash('sha256').update(`${SEED_NAMESPACE}:${label}`).digest();
  let id = '';
  for (let index = 0; index < 26; index += 1) {
    // The first character of a ULID is bounded to 0-7; everything after is free.
    const alphabet = index === 0 ? CROCKFORD.slice(0, 8) : CROCKFORD;
    id += alphabet[(digest[index] ?? 0) % alphabet.length];
  }
  return id;
}
