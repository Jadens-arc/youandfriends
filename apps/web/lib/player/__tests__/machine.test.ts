import { describe, expect, it } from 'vitest';

import {
  INITIAL_STATE,
  PLAYER_STATUSES,
  transition,
  type PlayerEvent,
  type PlayerState,
  type Track,
} from '../machine';

const TRACK: Track = {
  versionId: 'V1',
  songId: 'S1',
  title: 'Headlights',
  artist: 'Avery',
  versionLabel: 'Version 1',
};

function run(...events: PlayerEvent[]): PlayerState {
  return events.reduce(transition, INITIAL_STATE);
}

const media = (event: Extract<PlayerEvent, { type: 'media' }>['event'], currentTime?: number) =>
  ({ type: 'media', event, ...(currentTime === undefined ? {} : { currentTime }) }) as const;

describe('the player state machine (task 070)', () => {
  it('reaches every listed state', () => {
    const reached = new Set<string>([
      run().status,
      run({ type: 'load', track: TRACK, autoplay: true }).status,
      run({ type: 'load', track: TRACK, autoplay: false }, media('canplay')).status,
      run({ type: 'load', track: TRACK, autoplay: true }, media('playing')).status,
      run({ type: 'load', track: TRACK, autoplay: true }, media('playing'), media('pause')).status,
      run({ type: 'load', track: TRACK, autoplay: true }, media('playing'), media('seeking'))
        .status,
      run({ type: 'load', track: TRACK, autoplay: true }, media('playing'), media('waiting'))
        .status,
      run({ type: 'load', track: TRACK, autoplay: true }, media('playing'), media('ended')).status,
      run({ type: 'load', track: TRACK, autoplay: true }, { type: 'failed', kind: 'decode' })
        .status,
    ]);
    expect([...reached].sort()).toEqual([...PLAYER_STATUSES].sort());
  });

  it('distinguishes stalled from loading: only a playing track can stall', () => {
    expect(run({ type: 'load', track: TRACK, autoplay: true }, media('waiting')).status).toBe(
      'loading',
    );
    expect(
      run({ type: 'load', track: TRACK, autoplay: true }, media('playing'), media('stalled'))
        .status,
    ).toBe('stalled');
    // And recovers when data flows again.
    expect(
      run(
        { type: 'load', track: TRACK, autoplay: true },
        media('playing'),
        media('waiting'),
        media('playing'),
      ).status,
    ).toBe('playing');
  });

  it('returns to what the listener wanted after a seek', () => {
    const playing = run({ type: 'load', track: TRACK, autoplay: true }, media('playing'));
    expect(transition(transition(playing, media('seeking')), media('seeked')).status).toBe(
      'playing',
    );
    const paused = run(
      { type: 'load', track: TRACK, autoplay: false },
      media('canplay'),
      media('seeking'),
      media('seeked'),
    );
    expect(paused.status).toBe('paused');
  });

  it('keeps the wish to play through a network failure, and drops it for a terminal one', () => {
    const playing = run({ type: 'load', track: TRACK, autoplay: true }, media('playing'));
    const network = transition(playing, { type: 'failed', kind: 'network' });
    expect(network).toMatchObject({
      status: 'error',
      error: { kind: 'network' },
      wantsToPlay: true,
    });
    for (const kind of ['decode', 'unauthorized', 'not_ready', 'unavailable'] as const) {
      expect(transition(playing, { type: 'failed', kind })).toMatchObject({
        status: 'error',
        wantsToPlay: false,
      });
    }
    // Recovering from a network failure goes back through loading, then playing.
    const recovered = [{ type: 'recovering' } as const, media('canplay'), media('playing')].reduce(
      transition,
      network,
    );
    expect(recovered).toMatchObject({ status: 'playing', error: null });
  });

  it('marks a refresh without leaving the playing state', () => {
    const playing = run({ type: 'load', track: TRACK, autoplay: true }, media('playing'));
    const refreshing = transition(playing, { type: 'refresh', phase: 'start' });
    expect(refreshing).toMatchObject({ status: 'playing', refreshing: true });
    expect(transition(refreshing, { type: 'refresh', phase: 'done' }).refreshing).toBe(false);
  });

  it('treats a refused autoplay as ready, not as loading forever', () => {
    const blocked = run({ type: 'load', track: TRACK, autoplay: true }, { type: 'blocked' });
    expect(blocked).toMatchObject({ status: 'ready', wantsToPlay: false });
  });

  it('restarts an ended track from the top', () => {
    const ended = run(
      { type: 'load', track: TRACK, autoplay: true },
      media('playing', 180),
      media('ended', 187),
    );
    expect(ended).toMatchObject({ status: 'ended', wantsToPlay: false, positionSeconds: 187 });
    expect(transition(ended, { type: 'play' })).toMatchObject({
      wantsToPlay: true,
      positionSeconds: 0,
    });
  });

  it('ignores media events with no track, and stop returns to idle', () => {
    expect(transition(INITIAL_STATE, media('playing'))).toBe(INITIAL_STATE);
    expect(transition(INITIAL_STATE, { type: 'play' })).toBe(INITIAL_STATE);
    const playing = run({ type: 'load', track: TRACK, autoplay: true }, media('playing'));
    expect(transition(playing, { type: 'stop' })).toEqual(INITIAL_STATE);
  });

  it('tracks position and a finite duration', () => {
    const state = run(
      { type: 'load', track: TRACK, autoplay: true },
      { type: 'media', event: 'durationchange', duration: Number.NaN },
      { type: 'media', event: 'durationchange', duration: 187.2 },
      { type: 'media', event: 'timeupdate', currentTime: 42 },
    );
    expect(state).toMatchObject({ positionSeconds: 42, durationSeconds: 187.2 });
  });
});
