import { describe, expect, it } from 'vitest';

import { parseSearch, SEARCH_MAX_LENGTH, snippetRuns } from '../query';

describe('parseSearch', () => {
  it('is nothing for an empty or blank query', () => {
    expect(parseSearch('')).toBeNull();
    expect(parseSearch('  \n\t ')).toBeNull();
  });

  it('escapes LIKE wildcards and the escape character', () => {
    expect(parseSearch('100%')?.pattern).toBe('%100\\%%');
    expect(parseSearch('a_b\\c')?.pattern).toBe('%a\\_b\\\\c%');
  });

  it('builds a prefix tsquery from letters and digits only', () => {
    expect(parseSearch('Long  road!')?.tsquery).toBe('long:* & road:*');
    expect(parseSearch("a | !b & (c:*) 'd")?.tsquery).toBe('a:* & b:* & c:* & d:*');
    expect(parseSearch('¿Qué pasó? 2')?.tsquery).toBe('qué:* & pasó:* & 2:*');
    expect(parseSearch('!!! ???')?.tsquery).toBeNull();
  });

  it('bounds the query', () => {
    expect(parseSearch('x'.repeat(SEARCH_MAX_LENGTH * 3))?.text).toHaveLength(SEARCH_MAX_LENGTH);
    expect(
      parseSearch(Array.from({ length: 20 }, (_, i) => `w${i}`).join(' '))?.tsquery?.split('&'),
    ).toHaveLength(8);
  });
});

describe('snippetRuns', () => {
  const S = '\u0001';
  const E = '\u0002';
  it('splits a headline into plain and matched runs', () => {
    expect(snippetRuns(`nobody knows the ${S}long${E} ${S}road${E}\nhome`, S, E)).toEqual([
      { text: 'nobody knows the ', match: false },
      { text: 'long', match: true },
      { text: ' ', match: false },
      { text: 'road', match: true },
      { text: ' home', match: false },
    ]);
  });

  it('keeps markup in lyrics as text', () => {
    expect(snippetRuns(`<b>${S}x${E}</b>`, S, E)).toEqual([
      { text: '<b>', match: false },
      { text: 'x', match: true },
      { text: '</b>', match: false },
    ]);
  });
});
