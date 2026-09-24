import { EMPTY_LYRICS } from '@youandfriends/contracts';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { lyricsToText, textToLyrics } from '../text-format';
import {
  documentFromYjs,
  fromBase64,
  LYRICS_FRAGMENT,
  mergeYjs,
  toBase64,
  yjsFromDocument,
} from '../yjs';

const SHEET = textToLyrics('[Verse]\nHeadlights on\n[Chorus]\nStay, stay');

describe('lyrics as Yjs (task 082)', () => {
  it('round-trips a document, and no lyrics as no lyrics', () => {
    expect(lyricsToText(documentFromYjs(yjsFromDocument(SHEET)))).toBe(lyricsToText(SHEET));
    expect(documentFromYjs(yjsFromDocument(EMPTY_LYRICS))).toEqual(EMPTY_LYRICS);
    expect(documentFromYjs(new Uint8Array([0, 0]))).toEqual(EMPTY_LYRICS);
  });

  it('seeds identically every time, so two seeds merge into one copy, not two', () => {
    const first = yjsFromDocument(SHEET);
    const second = yjsFromDocument(SHEET);
    expect(toBase64(first)).toBe(toBase64(second));
    const merged = documentFromYjs(mergeYjs(first, second));
    expect(merged.content).toHaveLength(2);
  });

  it('merges two people’s divergent edits in either order', () => {
    const seed = yjsFromDocument(SHEET);
    const edit = (text: string) => {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, seed);
      const line = doc.getXmlFragment(LYRICS_FRAGMENT).get(0) as Y.XmlElement;
      const firstLine = line.get(0) as Y.XmlElement;
      (firstLine.get(0) as Y.XmlText).insert(0, text);
      return Y.encodeStateAsUpdate(doc);
    };
    const a = edit('A: ');
    const b = edit('B: ');
    const ab = documentFromYjs(mergeYjs(seed, a, b));
    const ba = documentFromYjs(mergeYjs(b, seed, a, a));
    expect(ab).toEqual(ba);
    const first = JSON.stringify(ab.content[0]);
    expect(first).toContain('A: ');
    expect(first).toContain('B: ');
    expect(first).toContain('Headlights on');
  });

  it('encodes base64 without Buffer', () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => i % 256);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});
