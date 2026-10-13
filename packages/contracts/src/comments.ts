import { z } from 'zod';

import { ulidSchema } from './ids';
import { hasForbiddenCharacter } from './lyrics';

/**
 * Comments (tasks `090`–`094`): the wire shapes, validated at the trust boundary.
 *
 * A comment body is **plain text** — never HTML, never markdown rendered to markup — and is shown
 * through React's escaping. Control characters and direction overrides are refused, as in lyrics:
 * they are how text is made to read differently from what it is.
 */

export const COMMENT_MAX_CHARACTERS = 5_000;

export const commentBodySchema = z
  .string()
  .trim()
  .min(1, 'Write something first.')
  .max(COMMENT_MAX_CHARACTERS, `Keep it under ${COMMENT_MAX_CHARACTERS} characters.`)
  .refine((value) => !hasForbiddenCharacter(value), {
    message: 'Comments may not contain control characters.',
  });

/** A Yjs relative position as JSON: small, and only what Yjs writes there. */
const yRelativePositionSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => JSON.stringify(value).length <= 1_000, 'Too large a position.');

/** The longest moment a timestamp comment can point at, as for lyric timestamps: six hours. */
const MAX_MS = 6 * 60 * 60 * 1000;

/**
 * Where a thread is anchored. One discriminator for all three kinds, designed here (task `090`)
 * so later tasks add behaviour, not columns: the whole song, a moment in one version (`091`), or
 * a range of the lyrics (`092`, which defines the lyric shape; bounded here).
 */
export const commentAnchorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('general') }),
  z.object({
    kind: z.literal('timestamp'),
    versionId: ulidSchema,
    ms: z.number().int().min(0).max(MAX_MS),
  }),
  z.object({
    kind: z.literal('lyric'),
    /** Yjs relative positions (task `092`): they name the characters, not their offsets. */
    start: yRelativePositionSchema,
    end: yRelativePositionSchema,
    /** The words as they were, kept so an orphaned comment still says what it was about. */
    quote: z
      .string()
      .max(500)
      .refine((value) => !hasForbiddenCharacter(value.replace(/\n/g, ' ')), {
        message: 'The quote may not contain control characters.',
      }),
    scope: z.enum(['selection', 'line', 'section']),
  }),
]);
export type CommentAnchor = z.infer<typeof commentAnchorSchema>;

/** Words that may be empty — when a voice note carries the comment instead (task `093`). */
const optionalBodySchema = z
  .string()
  .trim()
  .max(COMMENT_MAX_CHARACTERS, `Keep it under ${COMMENT_MAX_CHARACTERS} characters.`)
  .refine((value) => !hasForbiddenCharacter(value), {
    message: 'Comments may not contain control characters.',
  })
  .default('');

/** A comment says something: words, a voice note, or both — never neither. */
const saysSomething = (value: { body: string; voiceNoteAssetId?: string | undefined }) =>
  value.body !== '' || value.voiceNoteAssetId !== undefined;
const NOTHING_SAID = { message: 'Write something first, or record a voice note.', path: ['body'] };

export const createThreadSchema = z
  .object({
    anchor: commentAnchorSchema,
    body: optionalBodySchema,
    /** A recorded voice note (task `093`), uploaded before the comment is made. */
    voiceNoteAssetId: ulidSchema.optional(),
  })
  .refine(saysSomething, NOTHING_SAID);
export type CreateThreadRequest = z.input<typeof createThreadSchema>;

export const replySchema = z
  .object({ body: optionalBodySchema, voiceNoteAssetId: ulidSchema.optional() })
  .refine(saysSomething, NOTHING_SAID);
export type ReplyRequest = z.input<typeof replySchema>;

export const editCommentSchema = z.object({ body: commentBodySchema });
export type EditCommentRequest = z.infer<typeof editCommentSchema>;

export const resolveThreadSchema = z.object({ resolved: z.boolean() });
export type ResolveThreadRequest = z.infer<typeof resolveThreadSchema>;

/**
 * A mention in a comment's words (task `094`): `<@userId>`. A reference to the person, never
 * their name, so a rename does not orphan it; the name is filled in when the comment is shown.
 */
export const MENTION_PATTERN = /<@([0-9A-HJKMNP-TV-Z]{26})>/g;

/** At most this many distinct people in one comment — a mention is not a broadcast list. */
export const MAX_MENTIONS = 20;

/** The distinct people a comment's words mention, in the order they first appear. */
export function mentionedUserIds(body: string): string[] {
  const seen = new Set<string>();
  for (const match of body.matchAll(MENTION_PATTERN)) {
    if (match[1] !== undefined) seen.add(match[1]);
  }
  return [...seen];
}

/** The reactions a comment may carry. A fixed set: no custom emoji (task `094`). */
export const COMMENT_REACTIONS = ['👍', '❤️', '🔥', '😂', '🎵', '👀'] as const;
export type CommentReaction = (typeof COMMENT_REACTIONS)[number];

export const reactionSchema = z.object({
  emoji: z.enum(COMMENT_REACTIONS),
  /** `true` to add this person's reaction, `false` to take it back. Idempotent either way. */
  on: z.boolean(),
});
export type ReactionRequest = z.infer<typeof reactionSchema>;
