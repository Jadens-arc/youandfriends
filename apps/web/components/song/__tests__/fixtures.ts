import type { SongVersion, SongWorkspace } from '@/lib/songs/workspace';

export const NOW = new Date('2026-09-23T12:00:00Z');

export function version(overrides: Partial<SongVersion> = {}): SongVersion {
  return {
    id: 'V1',
    number: 1,
    isCurrent: false,
    note: null,
    uploadedAt: new Date('2026-09-20T12:00:00Z'),
    uploaderName: 'Avery Stone',
    fileName: 'Headlights.wav',
    contentType: 'audio/wav',
    sizeBytes: 50 * 1024 * 1024,
    durationMs: 187_000,
    codec: 'pcm_s24le',
    channels: 2,
    sampleRateHz: 48_000,
    bitDepth: 24,
    integratedLufs: -14.2,
    truePeakDb: -1.1,
    loudnessRangeLu: 5.2,
    loudnessUnavailable: null,
    processingState: 'complete',
    processingError: null,
    processingReference: null,
    noteEditable: true,
    ...overrides,
  };
}

export const VERSIONS: readonly SongVersion[] = [
  version({ id: 'V3', number: 3, processingState: 'running', note: 'Louder chorus' }),
  version({ id: 'V2', number: 2, isCurrent: true }),
  version({ id: 'V1', number: 1 }),
];

export function songWorkspace(overrides: Partial<SongWorkspace> = {}): SongWorkspace {
  return {
    song: {
      id: 'S1',
      title: 'Headlights on the Long Road Home Through the Valley',
      status: 'mixing',
      durationMs: 187_000,
      updatedAt: new Date('2026-09-22T12:00:00Z'),
      artist: null,
      notes: null,
    },
    project: { id: 'P1', name: 'Night Drive', artist: 'The Hours' },
    artist: 'The Hours',
    cover: null,
    collaborators: [
      { userId: 'u1', displayName: 'Avery Stone' },
      { userId: 'u2', displayName: 'Sam Reed' },
    ],
    isFavorite: true,
    capabilities: { comment: true, edit: true, download: true },
    versions: VERSIONS,
    currentVersionId: 'V2',
    files: { masters: [], stems: [], project_files: [], artwork: [] },
    knownTags: [],
    siblings: [
      { id: 'S1', title: 'Headlights', status: 'mixing', durationMs: 187_000, versionCount: 3 },
      { id: 'S2', title: 'Tail Lights', status: 'idea', durationMs: null, versionCount: 0 },
    ],
    ...overrides,
  };
}
