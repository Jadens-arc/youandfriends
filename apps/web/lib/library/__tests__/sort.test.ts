import { describe, expect, it } from 'vitest';

import { parseSort, parseView, sortProjects, type Sortable } from '../sort';

/** Library view preferences and project ordering (task `041`). */

function item(
  id: string,
  name: string,
  artist: string | null,
  created: string,
  active: string,
): Sortable {
  return {
    id,
    name,
    artist,
    createdAt: new Date(created),
    lastActivityAt: new Date(active),
  };
}

const PROJECTS: Sortable[] = [
  item('p1', 'track 10', 'Zed', '2026-01-03', '2026-09-01'),
  item('p2', 'Track 2', null, '2026-01-01', '2026-09-03'),
  item('p3', 'Alpha', 'avery', '2026-01-02', '2026-09-02'),
  item('p4', 'beta', 'Avery', '2026-01-04', '2026-09-02'),
];

const order = (sort: Parameters<typeof sortProjects>[1]) =>
  sortProjects(PROJECTS, sort).map((project) => project.id);

describe('sortProjects', () => {
  it('sorts by recent activity, newest first, breaking ties by name', () => {
    expect(order('recent')).toEqual(['p2', 'p3', 'p4', 'p1']);
  });

  it('sorts names the way a person reads them — no case, numbers as numbers', () => {
    expect(order('name')).toEqual(['p3', 'p4', 'p2', 'p1']);
  });

  it('sorts by artist, case-insensitively, with no artist last', () => {
    expect(order('artist')).toEqual(['p3', 'p4', 'p1', 'p2']);
  });

  it('sorts by date created, newest first', () => {
    expect(order('created')).toEqual(['p4', 'p1', 'p3', 'p2']);
  });

  it('does not reorder its input', () => {
    const before = PROJECTS.map((project) => project.id);
    sortProjects(PROJECTS, 'name');
    expect(PROJECTS.map((project) => project.id)).toEqual(before);
  });
});

describe('preference parsing', () => {
  it('accepts exactly the offered values', () => {
    expect(parseView('list')).toBe('list');
    expect(parseSort('created')).toBe('created');
  });

  it('falls back to the defaults for anything else', () => {
    expect(parseView(undefined)).toBe('grid');
    expect(parseView('LIST')).toBe('grid');
    expect(parseSort('')).toBe('recent');
    expect(parseSort('name; drop table')).toBe('recent');
  });
});
