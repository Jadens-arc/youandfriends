import { lyricsDocumentSchema, lyricsPlainText } from '@youandfriends/contracts';
import { describe, expect, it } from 'vitest';

import { kindOf, lyricsToText, textToLyrics } from '../text-format';

const TEXT = `[Verse 1]
Headlights on the long road home
Nobody knows

[Chorus]
Stay, stay

[Verse 2]
Tail lights

[Hook]
la la`;

describe('lyrics as bracketed text (task 080)', () => {
  it('reads sections by their bracketed headings, numbering derived, and writes them back the same', () => {
    const document = textToLyrics(TEXT);
    expect(lyricsDocumentSchema.parse(document)).toEqual(document);
    expect(document.content.map((section) => section.attrs)).toEqual([
      { kind: 'verse', label: null },
      { kind: 'chorus', label: null },
      { kind: 'verse', label: null },
      { kind: 'freeform', label: 'Hook' },
    ]);
    expect(lyricsToText(document)).toBe(TEXT);
  });

  it('keeps words typed before any heading, in a section of their own', () => {
    const document = textToLyrics('\nfirst words\n[Bridge]\nlater');
    expect(document.content[0]?.attrs).toEqual({ kind: 'freeform', label: null });
    expect(lyricsPlainText(document)).toBe('Section\nfirst words\n\nBridge\nlater');
  });

  it('knows the section names, whatever their spelling', () => {
    expect(kindOf('pre-chorus')).toEqual({ kind: 'pre_chorus', label: null });
    expect(kindOf('Pre Chorus 2')).toEqual({ kind: 'pre_chorus', label: null });
    expect(kindOf('Verse — alt')).toEqual({ kind: 'verse', label: 'Verse — alt' });
    expect(kindOf('Outro')).toEqual({ kind: 'outro', label: null });
    expect(kindOf('Tag')).toEqual({ kind: 'freeform', label: 'Tag' });
  });

  it('renumbers when the order changes, because the number is never stored', () => {
    const document = textToLyrics(TEXT);
    const [first, chorus, second, hook] = document.content;
    const reordered = { ...document, content: [second!, chorus!, first!, hook!] };
    expect(lyricsToText(reordered)).toMatch(/^\[Verse 1\]\nTail lights/);
    expect(lyricsToText(reordered)).toContain('[Verse 2]\nHeadlights');
  });

  it('keeps blank lines inside a section and an empty section', () => {
    const document = textToLyrics('[Verse]\none\n\ntwo\n\n[Chorus]');
    expect(lyricsToText(document)).toBe('[Verse]\none\n\ntwo\n\n[Chorus]\n');
  });
});
