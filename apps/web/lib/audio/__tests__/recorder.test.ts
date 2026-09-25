import { describe, expect, it, vi } from 'vitest';

import { createVoiceRecorder, extensionFor, pickMimeType } from '../recorder';
import { fakeMic } from './fake-mic';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the voice recorder (task 093)', () => {
  it('asks for the microphone only when started, and for audio alone', async () => {
    const mic = fakeMic();
    const recorder = createVoiceRecorder(mic.deps);
    expect(mic.requested).toHaveLength(0);
    await recorder.start();
    expect(mic.requested).toEqual([{ audio: true }]);
    expect(recorder.state()).toBe('recording');
  });

  it('releases every track the moment it stops, and keeps the recording', async () => {
    const mic = fakeMic();
    const recorder = createVoiceRecorder(mic.deps);
    await recorder.start();
    expect(mic.live()).toBe(2);
    mic.advance(12_000);
    const stopping = recorder.stop();
    // Released before the recorder has even delivered its last chunk.
    expect(mic.live()).toBe(0);
    const recording = await stopping;
    expect(recording?.mimeType).toBe('audio/webm;codecs=opus');
    expect(recording?.durationMs).toBe(12_000);
    expect(recording?.blob.size).toBe(512);
    expect(recorder.state()).toBe('idle');
    expect(mic.ticking()).toBe(false);
  });

  it('releases the microphone and keeps nothing on cancel', async () => {
    const mic = fakeMic();
    const recorder = createVoiceRecorder(mic.deps);
    await recorder.start();
    recorder.cancel();
    expect(mic.live()).toBe(0);
    await settle();
    expect(recorder.state()).toBe('idle');
  });

  it('never holds the microphone when cancelled while the permission prompt is up', async () => {
    const mic = fakeMic();
    const recorder = createVoiceRecorder(mic.deps);
    const starting = recorder.start();
    recorder.cancel();
    await starting;
    expect(mic.live()).toBe(0);
    expect(mic.recorders).toHaveLength(0);
    expect(recorder.state()).toBe('idle');
  });

  it('enforces the limit: stops at it, releases the microphone, and hands over the recording', async () => {
    const mic = fakeMic();
    const onLimit = vi.fn();
    const recorder = createVoiceRecorder({ ...mic.deps, limitMs: 60_000, onLimit });
    await recorder.start();
    mic.advance(59_000);
    expect(recorder.state()).toBe('recording');
    expect(recorder.remainingMs()).toBe(1_000);
    mic.advance(2_000);
    expect(mic.live()).toBe(0);
    await settle();
    expect(onLimit).toHaveBeenCalledTimes(1);
    expect(onLimit.mock.calls[0]?.[0]).toMatchObject({ durationMs: 60_000 });
    expect(recorder.state()).toBe('idle');
  });

  it('says "denied" when the microphone is refused, and holds nothing', async () => {
    const mic = fakeMic({ refuse: 'NotAllowedError' });
    const recorder = createVoiceRecorder(mic.deps);
    await recorder.start();
    expect(recorder.state()).toBe('denied');
    expect(mic.recorders).toHaveLength(0);
    recorder.reset();
    expect(recorder.state()).toBe('idle');
  });

  it('says "failed" for any other device error — no microphone, for instance', async () => {
    const mic = fakeMic({ refuse: 'NotFoundError' });
    const recorder = createVoiceRecorder(mic.deps);
    await recorder.start();
    expect(recorder.state()).toBe('failed');
  });

  it('releases the microphone when the recorder cannot be made, and says so', async () => {
    const mic = fakeMic({ recorderThrows: true });
    const recorder = createVoiceRecorder(mic.deps);
    await recorder.start();
    expect(recorder.state()).toBe('unsupported');
    expect(mic.live()).toBe(0);
  });

  it('releases the microphone and keeps nothing when recording errors', async () => {
    const mic = fakeMic();
    const recorder = createVoiceRecorder(mic.deps);
    await recorder.start();
    mic.recorders[0]?.onerror?.(new Event('error'));
    expect(mic.live()).toBe(0);
    expect(recorder.state()).toBe('failed');
    expect(mic.ticking()).toBe(false);
  });

  it('prefers Opus in WebM, falls back to AAC in MP4 for Safari, and names files to match', () => {
    expect(pickMimeType((type) => type.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus');
    expect(pickMimeType((type) => type.startsWith('audio/mp4'))).toBe('audio/mp4;codecs=mp4a.40.2');
    expect(pickMimeType(() => false)).toBeUndefined();
    expect(
      pickMimeType(() => {
        throw new Error('old Safari');
      }),
    ).toBeUndefined();
    expect(extensionFor('audio/mp4;codecs=mp4a.40.2')).toBe('m4a');
    expect(extensionFor('audio/webm;codecs=opus')).toBe('webm');
  });
});
