import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAudioElementAdapter, MEDIA_ERR } from '../audio-element';

/**
 * The adapter over a DOM `<audio>` element (task `070`).
 *
 * jsdom has the element and its events but no media pipeline — `play` and `load` are
 * unimplemented — so those two are stubbed on the prototype and everything else is the element's
 * own behaviour. Playback in a real browser (does audio actually come out, does a refresh really
 * not glitch) is task `120`'s Playwright suite; see the task file.
 */
describe('the audio element adapter', () => {
  let element: HTMLAudioElement;
  let play: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    play = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    element = document.createElement('audio');
    document.body.append(element);
  });

  afterEach(() => {
    element.remove();
    vi.restoreAllMocks();
  });

  it('restores the playhead and resumes once the new source has metadata', () => {
    const adapter = createAudioElementAdapter(element);
    adapter.setSource('https://r2.example/two', { startAt: 612.5, play: true });
    expect(element.src).toBe('https://r2.example/two');
    // Not before metadata: setting currentTime on an empty element is lost.
    expect(play).not.toHaveBeenCalled();

    element.dispatchEvent(new Event('loadedmetadata'));
    expect(element.currentTime).toBe(612.5);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('does not start a paused track on a refresh', () => {
    const adapter = createAudioElementAdapter(element);
    adapter.setSource('https://r2.example/two', { startAt: 30, play: false });
    element.dispatchEvent(new Event('loadedmetadata'));
    expect(element.currentTime).toBe(30);
    expect(play).not.toHaveBeenCalled();
  });

  it('reports a refused play', async () => {
    play.mockRejectedValue(new DOMException('no gesture', 'NotAllowedError'));
    const rejected = vi.fn();
    const adapter = createAudioElementAdapter(element);
    adapter.setSource('https://r2.example/one', {
      startAt: 0,
      play: true,
      onPlayRejected: rejected,
    });
    element.dispatchEvent(new Event('loadedmetadata'));
    await vi.waitFor(() => expect(rejected).toHaveBeenCalledTimes(1));
  });

  it('applies only the newest source’s restore when sources change quickly', () => {
    const adapter = createAudioElementAdapter(element);
    adapter.setSource('https://r2.example/one', { startAt: 10, play: false });
    adapter.setSource('https://r2.example/two', { startAt: 20, play: false });
    element.dispatchEvent(new Event('loadedmetadata'));
    expect(element.currentTime).toBe(20);
  });

  it('forwards the element’s events with its playhead, and stops when unsubscribed', () => {
    const adapter = createAudioElementAdapter(element);
    const seen: string[] = [];
    const unsubscribe = adapter.subscribe((event, snapshot) => {
      seen.push(`${event}@${snapshot.currentTime}`);
    });
    element.currentTime = 5;
    for (const name of ['playing', 'waiting', 'stalled', 'ended', 'error']) {
      element.dispatchEvent(new Event(name));
    }
    unsubscribe();
    element.dispatchEvent(new Event('playing'));
    expect(seen).toEqual(['playing@5', 'waiting@5', 'stalled@5', 'ended@5', 'error@5']);
  });

  it('clears its source without leaving the old URL on the element', () => {
    const adapter = createAudioElementAdapter(element);
    adapter.setSource('https://r2.example/one', { startAt: 0, play: false });
    adapter.clearSource();
    expect(element.getAttribute('src')).toBeNull();
    expect(adapter.errorCode).toBeNull();
    expect(MEDIA_ERR.NETWORK).toBe(2);
  });
});
