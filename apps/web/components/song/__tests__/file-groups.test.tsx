import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { SongFile } from '@/lib/songs/workspace';

import { FileGroups } from '../file-groups';

function file(overrides: Partial<SongFile>): SongFile {
  return {
    id: 'A1',
    kind: 'stem',
    name: 'Drums.wav',
    folderPath: '',
    tags: [],
    versionCount: 1,
    sizeBytes: 1024 * 1024,
    contentType: 'audio/wav',
    uploadedAt: new Date('2026-09-20T00:00:00Z'),
    uploaderName: 'Avery Stone',
    processingState: 'complete',
    ...overrides,
  };
}

describe('FileGroups', () => {
  it('renders the four fixed groups, in order, even when empty', () => {
    render(<FileGroups files={{ masters: [], stems: [], project_files: [], artwork: [] }} />);
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((h) => h.firstChild?.textContent),
    ).toEqual(['Masters', 'Stems & Samples', 'Project Files', 'Artwork']);
    expect(screen.getByText('No masters yet.')).toBeInTheDocument();
  });

  it('keeps exactly one Project Files area, organized by the user’s own folders', () => {
    render(
      <FileGroups
        files={{
          masters: [],
          stems: [file({ id: 'S', name: 'Drums.wav', tags: ['drums', 'live'] })],
          project_files: [
            file({ id: 'L', kind: 'project_file', name: 'Song.logicx.zip', folderPath: '/Logic/' }),
            file({ id: 'M', kind: 'project_file', name: 'Beat.xpj', folderPath: '/MPC/' }),
            file({ id: 'N', kind: 'project_file', name: 'Notes.txt' }),
          ],
          artwork: [],
        }}
      />,
    );
    const area = screen.getByRole('region', { name: /Project Files/ });
    // The person's own folders, as collapsible groups inside the one area.
    expect(within(area).getByText('Logic').closest('summary')).not.toBeNull();
    expect(within(area).getByText('MPC').closest('summary')).not.toBeNull();
    expect(within(area).getByText('Notes.txt')).toBeInTheDocument();
    // No product-level Logic or MPC section: those names exist only as the user's own folders.
    expect(
      screen
        .getAllByRole('heading', { level: 3 })
        .filter((h) => /Logic|MPC/.test(h.textContent ?? '')),
    ).toEqual([]);
    expect(screen.getByText('drums, live')).toBeInTheDocument();
  });

  it('marks unfinished audio processing in words', () => {
    render(
      <FileGroups
        files={{
          masters: [file({ id: 'X', kind: 'master', processingState: 'queued' })],
          stems: [],
          project_files: [],
          artwork: [],
        }}
      />,
    );
    expect(screen.getByText('Queued for processing')).toBeInTheDocument();
  });
});
