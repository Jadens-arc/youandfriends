import {
  lineText,
  sectionHeading,
  SECTION_KINDS,
  SECTION_LABELS,
  type LyricsDocument,
  type LyricsSection,
  type SectionKind,
} from '@youandfriends/contracts';

/**
 * Lyrics as plain text with bracketed headings — `[Chorus]`, `[Verse 2]` — and back (task `080`).
 * The interim editing surface until the structured editor (task `081`); it round-trips the
 * section structure so nothing written here is lost when that editor arrives.
 */

const HEADING = /^\s*\[(.{1,80})\]\s*$/;

/** "Verse 2" → verse, labelled; "Chorus" → chorus; "Hook" → a freeform section called Hook. */
export function kindOf(heading: string): { kind: SectionKind; label: string | null } {
  const clean = heading.trim();
  const lower = clean.toLowerCase().replace(/[\s_-]+/g, ' ');
  for (const kind of SECTION_KINDS) {
    if (kind === 'freeform') continue;
    const name = SECTION_LABELS[kind].toLowerCase().replace(/[\s_-]+/g, ' ');
    if (lower === name) return { kind, label: null };
    if (lower.startsWith(`${name} `)) return { kind, label: clean };
  }
  return { kind: 'freeform', label: clean };
}

export function lyricsToText(document: LyricsDocument): string {
  return document.content
    .map((section) =>
      [`[${sectionHeading(section)}]`, ...section.content.map((line) => lineText(line))].join('\n'),
    )
    .join('\n\n');
}

export function textToLyrics(text: string): LyricsDocument {
  const sections: LyricsSection[] = [];
  let current: { kind: SectionKind; label: string | null; lines: string[] } | null = null;
  const close = () => {
    if (current === null) return;
    // Blank lines between sections are separators, not lyrics.
    while (current.lines.length > 0 && current.lines.at(-1)?.trim() === '') current.lines.pop();
    const lines = current.lines.length === 0 ? [''] : current.lines;
    sections.push({
      type: 'lyricsSection',
      attrs: { kind: current.kind, label: current.label },
      content: lines.map((line) =>
        line === ''
          ? { type: 'lyricsLine' as const }
          : { type: 'lyricsLine' as const, content: [{ type: 'text' as const, text: line }] },
      ),
    });
  };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = HEADING.exec(raw);
    if (heading !== null) {
      close();
      current = { ...kindOf(heading[1] as string), lines: [] };
      continue;
    }
    if (current === null) {
      if (raw.trim() === '') continue;
      current = { kind: 'freeform', label: null, lines: [] };
    }
    current.lines.push(raw.replace(/\s+$/, ''));
  }
  close();
  return { type: 'doc', content: sections };
}
