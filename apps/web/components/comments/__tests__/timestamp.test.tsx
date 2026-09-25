import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SongPlayback } from '@/lib/comments/playback';

/** The one player, as a fake whose loaded song and playhead the test moves. */
const player = vi.hoisted(() => ({
  state: { track: null as null | { songId: string; versionId: string }, wantsToPlay: false },
  time: 0,
  seek: vi.fn(),
  play: vi.fn(),
  load: vi.fn(async (_track: unknown, _options: unknown) => {}),
}));
vi.mock('@/lib/player/store', () => ({
  usePlayerState: () => player.state,
  getPlayer: () => ({
    getState: () => player.state,
    currentTime: () => player.time,
    seek: (s: number) => player.seek(s),
    play: () => player.play(),
    load: (track: unknown, options: unknown) => player.load(track, options),
  }),
}));

const { clusterMarkers, CommentMarkers } =
  await import('@/components/player/waveform/comment-markers');
const { TimestampComments } = await import('../timestamp/timestamp-comments');
const { CommentsPanel } = await import('../comments-panel');

const PLAYBACK: SongPlayback = {
  songId: 'S1',
  songTitle: 'Headlights',
  artist: null,
  cover: null,
  album: null,
  versions: [
    { id: 'V3', number: 3, current: true },
    { id: 'V2', number: 2, current: false },
  ],
};

const comment = (id: string, body: string, author = 'Sam') => ({
  id,
  author,
  body,
  createdAt: '2026-09-24T10:00:00.000Z',
  editedAt: null,
  deleted: false,
  canEdit: false,
  canDelete: false,
});

const THREADS = [
  {
    id: 'T1',
    anchor: { kind: 'timestamp', versionId: 'V2', ms: 102_000 },
    resolvedAt: null,
    resolvedBy: null,
    comments: [comment('C1', 'The snare is too loud here.')],
  },
  {
    id: 'T2',
    anchor: { kind: 'timestamp', versionId: 'V3', ms: 103_000 },
    resolvedAt: null,
    resolvedBy: null,
    comments: [comment('C2', 'And the hi-hat.', 'Alex')],
  },
  {
    id: 'T3',
    anchor: { kind: 'timestamp', versionId: 'V3', ms: 20_000 },
    resolvedAt: null,
    resolvedBy: null,
    comments: [comment('C3', 'Great intro.', 'Alex')],
  },
  {
    id: 'T4',
    anchor: { kind: 'general' },
    resolvedAt: null,
    resolvedBy: null,
    comments: [comment('C4', 'Overall: yes.')],
  },
];

function stubFetch() {
  const posts: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ threadId: 'T9', commentId: 'C9' }), { status: 201 });
      }
      return new Response(JSON.stringify({ threads: THREADS, canComment: true }));
    }),
  );
  return posts;
}

const at = (seconds: number, versionId = 'V3') => {
  player.state = { track: { songId: 'S1', versionId }, wantsToPlay: true };
  player.time = seconds;
};

async function settle() {
  await act(async () => {});
}

beforeEach(() => {
  player.state = { track: null, wantsToPlay: false };
  player.time = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  player.seek.mockReset();
  player.play.mockReset();
  player.load.mockReset();
});

describe('marker clustering (task 091)', () => {
  const marker = (threadId: string, ms: number) => ({
    threadId,
    ms,
    versionId: 'V3',
    author: 'Sam',
    excerpt: threadId,
  });

  it('gathers comments too close to tell apart, and keeps spread ones separate', () => {
    const clusters = clusterMarkers(
      [marker('a', 100_000), marker('b', 103_000), marker('c', 20_000), marker('d', 104_000)],
      240_000,
    );
    expect(clusters.map((cluster) => cluster.items.map((item) => item.threadId))).toEqual([
      ['c'],
      ['a', 'b', 'd'],
    ]);
    // A cluster spans from its first comment only: a long chain does not become one smear.
    const chain = clusterMarkers(
      Array.from({ length: 10 }, (_, i) => marker(`m${i}`, i * 5_000)),
      240_000,
    );
    expect(chain.length).toBeGreaterThan(1);
  });
});

describe('markers on the timeline (task 091)', () => {
  const comments = [
    {
      threadId: 'T1',
      ms: 102_000,
      versionId: 'V2',
      author: 'Sam',
      excerpt: 'The snare is too loud here.',
    },
    { threadId: 'T2', ms: 103_000, versionId: 'V3', author: 'Alex', excerpt: 'And the hi-hat.' },
    { threadId: 'T3', ms: 20_000, versionId: 'V3', author: 'Alex', excerpt: 'Great intro.' },
  ];

  it('names each marker with its time, author, and words, and plays it when pressed', () => {
    const onPlay = vi.fn();
    render(<CommentMarkers comments={comments} durationMs={240_000} onPlay={onPlay} />);
    const lane = screen.getByRole('group', { name: 'Comments on the timeline' });
    const single = within(lane).getByRole('button', {
      name: 'Comment at 0:20 by Alex: Great intro.',
    });
    fireEvent.click(single);
    expect(onPlay).toHaveBeenCalledWith(comments[2]);
  });

  it('opens a cluster into a list, each entry playable', () => {
    const onPlay = vi.fn();
    render(<CommentMarkers comments={comments} durationMs={240_000} onPlay={onPlay} />);
    const cluster = screen.getByRole('button', { name: '2 comments from 1:42 to 1:43' });
    expect(cluster).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(cluster);
    expect(cluster).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('list', { name: 'Comments in this cluster' });
    fireEvent.click(within(list).getByRole('button', { name: /1:43.*Alex — And the hi-hat\./ }));
    expect(onPlay).toHaveBeenCalledWith(comments[1]);
  });

  it('moves between markers with the arrow keys', () => {
    render(<CommentMarkers comments={comments} durationMs={240_000} onPlay={() => {}} />);
    const lane = screen.getByRole('group', { name: 'Comments on the timeline' });
    const [first, second] = within(lane).getAllByRole('button');
    first?.focus();
    fireEvent.keyDown(first!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second!, { key: 'Home' });
    expect(document.activeElement).toBe(first);
  });

  it('stays out of the way with nothing to show', () => {
    const { container } = render(
      <CommentMarkers comments={[]} durationMs={240_000} onPlay={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('commenting on a moment (task 091)', () => {
  it('anchors where the playhead was when the comment began, not when it was sent', async () => {
    const posts = stubFetch();
    at(42.5);
    render(<TimestampComments playback={PLAYBACK} durationMs={240_000} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Comment at the playhead' }));
    const box = screen.getByLabelText('Comment at 0:42 in version 3');
    // The song plays on while the words are typed.
    at(61);
    fireEvent.change(box, { target: { value: 'Snare too loud' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    });
    expect(posts).toEqual([
      { anchor: { kind: 'timestamp', versionId: 'V3', ms: 42_500 }, body: 'Snare too loud' },
    ]);
  });

  it('opens with one key, C, but not while typing elsewhere', async () => {
    stubFetch();
    at(10);
    const { container } = render(
      <>
        <textarea aria-label="Elsewhere" />
        <TimestampComments playback={PLAYBACK} durationMs={240_000} />
      </>,
    );
    await settle();
    fireEvent.keyDown(screen.getByLabelText('Elsewhere'), { key: 'c' });
    expect(screen.queryByLabelText(/^Comment at 0:10/)).toBeNull();
    fireEvent.keyDown(container.ownerDocument.body, { key: 'c' });
    expect(screen.getByLabelText('Comment at 0:10 in version 3')).toBeInTheDocument();
  });

  it('asks for the song to be playing before commenting on a moment of it', async () => {
    stubFetch();
    player.state = { track: { songId: 'OTHER', versionId: 'X' }, wantsToPlay: true };
    render(<TimestampComments playback={PLAYBACK} durationMs={240_000} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Comment at the playhead' }));
    expect(screen.getByText('Play this song to comment on a moment in it.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /^Comment at/ })).toBeNull();
  });

  it('draws the song’s moment comments as markers, and plays from one', async () => {
    stubFetch();
    render(<TimestampComments playback={PLAYBACK} durationMs={240_000} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Comment at 0:20 by Alex: Great intro.' }));
    // Nothing of this song loaded: its version loads, at the moment.
    expect(player.load).toHaveBeenCalledWith(expect.objectContaining({ versionId: 'V3' }), {
      autoplay: true,
      startAt: 20,
    });
  });
});

describe('moments in the comments list (task 091)', () => {
  it('shows a moment in mono tabular figures, and seeks when this song is playing', async () => {
    stubFetch();
    at(5);
    render(<CommentsPanel songId="S1" playback={PLAYBACK} />);
    await settle();
    const chip = screen.getByRole('button', { name: 'Play from 1:42 in version 2' });
    expect(chip.className).toMatch(/font-mono/);
    expect(chip.className).toMatch(/tabular/);
    fireEvent.click(chip);
    expect(player.seek).toHaveBeenCalledWith(102);
    expect(player.play).toHaveBeenCalled();
    expect(player.load).not.toHaveBeenCalled();
  });
});
