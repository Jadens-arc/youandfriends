import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ProjectCard as ProjectCardData } from '@/lib/library/projects';

import { CoverArt } from '../cover-art';
import { collaboratorSummary, GRID_COVER_SIZES, ProjectCard, ProjectRow } from '../project-card';
import { ProjectGrid } from '../project-grid';

/**
 * The project card and row (task `041`): artwork first, every required fact present, and a
 * screen reader told the same story the eye is.
 */

const NOW = new Date('2026-09-23T12:00:00Z');

function project(overrides: Partial<ProjectCardData> = {}): ProjectCardData {
  return {
    id: 'P1',
    name: 'Night Drives',
    artist: 'The Hours',
    songCount: 7,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    lastActivityAt: new Date('2026-09-20T12:00:00Z'),
    cover: null,
    collaborators: [
      { userId: 'u1', displayName: 'Avery Stone' },
      { userId: 'u2', displayName: 'Sam Reed' },
    ],
    ...overrides,
  };
}

const people = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    userId: `u${index}`,
    displayName: `Person ${index}`,
  }));

describe('ProjectCard', () => {
  it('names the project as a heading, with artist, song count, and last activity', () => {
    render(<ProjectCard project={project()} now={NOW} />);
    const card = screen.getByRole('article');
    expect(within(card).getByRole('heading', { name: 'Night Drives' })).toBeInTheDocument();
    expect(card).toHaveTextContent('The Hours');
    expect(card).toHaveTextContent('7 songs');
    const time = within(card).getByText('3 days ago');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('dateTime', '2026-09-20T12:00:00.000Z');
    expect(card).toHaveTextContent('Last activity');
  });

  it('says plainly when there is no artist yet, and counts one song as one', () => {
    render(<ProjectCard project={project({ artist: null, songCount: 1 })} now={NOW} />);
    expect(screen.getByText('No artist yet')).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveTextContent('1 song');
  });

  it('draws the placeholder cover, decoratively, when there is no artwork', () => {
    const { container } = render(<ProjectCard project={project()} now={NOW} />);
    expect(container.querySelector('img')).toBeNull();
    const placeholder = container.querySelector('[aria-hidden="true"]');
    expect(placeholder).toHaveTextContent('ND');
  });

  it('names every collaborator to a screen reader, and shows at most three faces', () => {
    render(<ProjectCard project={project({ collaborators: people(5) })} now={NOW} />);
    expect(
      screen.getByText('Shared with Person 0, Person 1, Person 2, and 2 others'),
    ).toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('shows no collaborator stack for a project nobody else can reach', () => {
    render(<ProjectCard project={project({ collaborators: [] })} now={NOW} />);
    expect(screen.queryByText(/Shared with/)).toBeNull();
  });
});

describe('collaboratorSummary', () => {
  it('reads naturally at every size', () => {
    expect(collaboratorSummary([])).toBe('No collaborators');
    expect(collaboratorSummary(people(1))).toBe('Shared with Person 0');
    expect(collaboratorSummary(people(3))).toBe('Shared with Person 0, Person 1, and Person 2');
    expect(collaboratorSummary(people(4))).toBe(
      'Shared with Person 0, Person 1, Person 2, and 1 other',
    );
  });
});

describe('CoverArt', () => {
  it('serves sized renditions, never a bare original, when artwork exists', () => {
    const { container } = render(
      <CoverArt
        id="P1"
        name="Night Drives"
        cover={{ src: '/c/256', srcSet: '/c/256 256w, /c/512 512w' }}
        sizes={GRID_COVER_SIZES}
      />,
    );
    const image = container.querySelector('img');
    expect(image).toHaveAttribute('srcset', '/c/256 256w, /c/512 512w');
    expect(image).toHaveAttribute('sizes', GRID_COVER_SIZES);
    expect(image).toHaveAttribute('loading', 'lazy');
    // Decorative: the card names the project in text beside it.
    expect(image).toHaveAttribute('alt', '');
  });

  it('gives the same project the same placeholder tint every time', () => {
    const first = render(<CoverArt id="P1" name="A" cover={null} sizes="1px" />);
    const tint = first.container.firstElementChild?.className;
    first.unmount();
    const second = render(<CoverArt id="P1" name="A" cover={null} sizes="1px" />);
    expect(second.container.firstElementChild?.className).toBe(tint);
  });
});

describe('ProjectRow', () => {
  it('carries the same facts as the card, in columns', () => {
    render(<ProjectRow project={project()} now={NOW} />);
    const row = screen.getByRole('article');
    expect(within(row).getByRole('heading', { name: 'Night Drives' })).toBeInTheDocument();
    expect(row).toHaveTextContent('The Hours');
    expect(row).toHaveTextContent('7 songs');
    expect(row).toHaveTextContent('3 days ago');
    expect(row).toHaveTextContent('Shared with Avery Stone and Sam Reed');
  });
});

describe('ProjectGrid', () => {
  const projects = [project(), project({ id: 'P2', name: 'Second' })];

  it('renders a labelled list of cards in grid mode', () => {
    render(<ProjectGrid projects={projects} view="grid" now={NOW} label="Projects" />);
    const list = screen.getByRole('list', { name: 'Projects' });
    expect(within(list).getAllByRole('article')).toHaveLength(2);
    expect(list.className).toContain('grid-cols-2');
  });

  it('renders rows in list mode, in the order given', () => {
    render(<ProjectGrid projects={projects} view="list" now={NOW} label="Projects" />);
    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent);
    expect(headings).toEqual(['Night Drives', 'Second']);
    expect(screen.getByRole('list', { name: 'Projects' }).className).not.toContain('grid-cols-2');
  });
});
