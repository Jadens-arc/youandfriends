import { tierForWidth } from './tier';

/**
 * Decodes waveform peaks off the main thread (task `072`): on a phone, parsing and copying a
 * long track's peaks on the main thread is enough to stutter playback.
 */
self.onmessage = (event: MessageEvent<{ id: number; bytes: ArrayBuffer; widthPx: number }>) => {
  const { id, bytes, widthPx } = event.data;
  try {
    const tier = tierForWidth(new Uint8Array(bytes), widthPx);
    (self as unknown as Worker).postMessage({ id, tier }, [tier.peaks.buffer]);
  } catch (error) {
    (self as unknown as Worker).postMessage({
      id,
      error: error instanceof Error ? error.message : 'could not decode',
    });
  }
};
