import { z } from 'zod';

/**
 * Lyrics (tasks `080`–`085`, ADR 0003): the canonical document, as the Tiptap editor writes it,
 * validated here at the trust boundary before anything is stored.
 *
 * A song's lyrics are a list of **sections** — Verse, Pre-Chorus, Chorus, Bridge, Outro, or a
 * freeform one with its own label (`docs/DESIGN.md` §6) — each holding **lines**. A section and a
 * line can carry an optional timestamp into the audio (task `083`). Text is plain text: no marks
 * beyond what the design names, no HTML, nothing the page could render as markup.
 */

export const SECTION_KINDS = [
  'verse',
  'pre_chorus',
  'chorus',
  'bridge',
  'intro',
  'outro',
  'freeform',
] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export const SECTION_LABELS: Readonly<Record<SectionKind, string>> = {
  verse: 'Verse',
  pre_chorus: 'Pre-Chorus',
  chorus: 'Chorus',
  bridge: 'Bridge',
  intro: 'Intro',
  outro: 'Outro',
  freeform: 'Section',
};

/** A lyric sheet longer than this is not a song. The bound keeps a stored row reasonable. */
export const LYRICS_MAX_CHARACTERS = 100_000;
export const LYRICS_MAX_SECTIONS = 200;
export const LYRICS_MAX_LINES_PER_SECTION = 400;

const timestampSchema = z
  .number()
  .int()
  .min(0)
  .max(6 * 60 * 60 * 1000)
  .nullable()
  .optional();

/** C0 controls other than tab and newline, DEL, and the bidirectional embeddings and isolates. */
function hasForbiddenCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0x09 || code === 0x0a) continue;
    if (code < 0x20 || code === 0x7f) return true;
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) return true;
  }
  return false;
}

const textSchema = z.object({
  type: z.literal('text'),
  // Control characters are refused rather than stored: they have no place in a lyric and some
  // (bidirectional overrides) are how text is made to read differently from what it is.
  text: z
    .string()
    .min(1)
    .max(2_000)
    .refine((value) => !hasForbiddenCharacter(value), {
      message: 'Lyrics may not contain control characters.',
    }),
});

export const lyricsLineSchema = z.object({
  type: z.literal('lyricsLine'),
  attrs: z.object({ timestampMs: timestampSchema }).optional(),
  content: z.array(textSchema).max(50).optional(),
});

export const lyricsSectionSchema = z.object({
  type: z.literal('lyricsSection'),
  attrs: z.object({
    kind: z.enum(SECTION_KINDS),
    /**
     * A name the writer gave the section ("Hook", "Verse — alt"). Absent, the heading is the
     * kind's name, numbered by order when the kind repeats — derived, never stored, so it cannot
     * go stale when sections are reordered (task `081`).
     */
    label: z.string().max(80).nullable().optional(),
    timestampMs: timestampSchema,
  }),
  content: z.array(lyricsLineSchema).min(1).max(LYRICS_MAX_LINES_PER_SECTION),
});

export const lyricsDocumentSchema = z
  .object({
    type: z.literal('doc'),
    content: z.array(lyricsSectionSchema).max(LYRICS_MAX_SECTIONS),
  })
  .refine((document) => lyricsPlainText(document).length <= LYRICS_MAX_CHARACTERS, {
    message: 'These lyrics are too long to save.',
  });

export type LyricsDocument = z.infer<typeof lyricsDocumentSchema>;
export type LyricsSection = z.infer<typeof lyricsSectionSchema>;
export type LyricsLine = z.infer<typeof lyricsLineSchema>;

export const EMPTY_LYRICS: LyricsDocument = { type: 'doc', content: [] };

/**
 * Every section's heading as a person reads it, in order: its own name if it has one, otherwise
 * its kind's name — "Verse 1", "Verse 2" when unnamed sections of that kind repeat, plain "Bridge"
 * when there is one. Numbering is derived from order on every call.
 */
export function sectionHeadings(
  sections: readonly Pick<LyricsSection, 'attrs'>[],
): readonly string[] {
  const unnamed = (section: Pick<LyricsSection, 'attrs'>) => {
    const label = section.attrs.label?.trim();
    return label === undefined || label === '' ? null : label;
  };
  const totals = new Map<SectionKind, number>();
  for (const section of sections) {
    if (unnamed(section) !== null) continue;
    totals.set(section.attrs.kind, (totals.get(section.attrs.kind) ?? 0) + 1);
  }
  const seen = new Map<SectionKind, number>();
  return sections.map((section) => {
    const label = unnamed(section);
    if (label !== null) return label;
    const kind = section.attrs.kind;
    const ordinal = (seen.get(kind) ?? 0) + 1;
    seen.set(kind, ordinal);
    return (totals.get(kind) ?? 0) > 1
      ? `${SECTION_LABELS[kind]} ${ordinal}`
      : SECTION_LABELS[kind];
  });
}

export function lineText(line: Pick<LyricsLine, 'content'>): string {
  return (line.content ?? []).map((node) => node.text).join('');
}

/**
 * The plain-text projection: every section's heading and lines, sections separated by a blank
 * line. **Derived, never authored** — regenerated from the document on every save, so what search
 * finds (task `045`) cannot drift from what is on the page.
 */
export function lyricsPlainText(document: {
  readonly content: readonly Pick<LyricsSection, 'attrs' | 'content'>[];
}): string {
  const headings = sectionHeadings(document.content);
  return document.content
    .map((section, index) =>
      [headings[index] ?? '', ...section.content.map((line) => lineText(line))].join('\n'),
    )
    .join('\n\n');
}

/**
 * A save. `baseVersion` is the version the editor started from; a save against anything else is
 * a conflict — never a silent overwrite of someone else's words.
 */
export const saveLyricsSchema = z.object({
  document: lyricsDocumentSchema,
  baseVersion: z.number().int().min(0),
  /**
   * The Yjs document update from the realtime layer (task `082`), base64. Absent in single-player
   * editing. Bounded: a lyric sheet's CRDT state is kilobytes.
   */
  yjsState: z
    .string()
    .max(2_000_000)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/, 'must be base64')
    .nullable()
    .optional(),
  /**
   * A save made as the page is left (page hide, navigation). It may leave an automatic revision
   * sooner than the usual time floor — the writing session is ending (task `084`).
   */
  lifecycle: z.boolean().optional(),
});
export type SaveLyricsRequest = z.infer<typeof saveLyricsSchema>;

/** A named checkpoint of the lyrics as they stand (task `084`). */
export const createCheckpointSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Give the checkpoint a name.')
    .max(80, 'Keep the name under 80 characters.'),
});
export type CreateCheckpointRequest = z.infer<typeof createCheckpointSchema>;
