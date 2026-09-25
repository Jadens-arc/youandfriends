import { describe, expect, it } from 'vitest';

import {
  lyricsDocumentSchema,
  lyricsPlainText,
  sectionHeadings,
  type LyricsDocument,
} from './lyrics';

const withLine = (text: string): LyricsDocument => ({
  type: 'doc',
  content: [
    {
      type: 'lyricsSection',
      attrs: { kind: 'verse', label: 'Verse 2' },
      content: [{ type: 'lyricsLine', content: [{ type: 'text', text }] }],
    },
  ],
});

describe('lyrics documents', () => {
  it('accepts plain lyrics, tabs included', () => {
    expect(lyricsDocumentSchema.safeParse(withLine('Stay,\tstay — ¿qué?')).success).toBe(true);
  });

  it.each([
    ['a NUL', `a${String.fromCharCode(0)}b`],
    ['an escape', `a${String.fromCharCode(0x1b)}[31m`],
    ['DEL', `a${String.fromCharCode(0x7f)}`],
    ['a right-to-left override', `a${String.fromCharCode(0x202e)}b`],
    ['a directional isolate', `a${String.fromCharCode(0x2067)}b`],
  ])('refuses %s', (_name, text) => {
    expect(lyricsDocumentSchema.safeParse(withLine(text)).success).toBe(false);
  });

  it('projects headings and lines to plain text, a blank line between sections', () => {
    const document: LyricsDocument = {
      type: 'doc',
      content: [
        ...withLine('first').content,
        {
          type: 'lyricsSection',
          attrs: { kind: 'chorus' },
          content: [
            { type: 'lyricsLine' },
            { type: 'lyricsLine', content: [{ type: 'text', text: 'hook' }] },
          ],
        },
      ],
    };
    expect(lyricsPlainText(document)).toBe('Verse 2\nfirst\n\nChorus\n\nhook');
  });

  it('numbers a kind only when it repeats, by order, skipping named sections', () => {
    const attrs = (kind: 'verse' | 'chorus' | 'bridge', label: string | null = null) => ({
      attrs: { kind, label },
    });
    expect(
      sectionHeadings([
        attrs('verse'),
        attrs('chorus'),
        attrs('verse', 'Verse — alt'),
        attrs('verse'),
        attrs('bridge'),
        attrs('chorus', '  '),
      ]),
    ).toEqual(['Verse 1', 'Chorus 1', 'Verse — alt', 'Verse 2', 'Bridge', 'Chorus 2']);
  });
});
