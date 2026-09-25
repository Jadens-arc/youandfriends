import { formatClock } from '@/lib/player/format';

/**
 * A timestamp as the page shows it (task `083`): a small button in the monospace face with
 * tabular figures, `1:23`, named for what it plays — "Play Verse 2 from 1:23".
 */
export function timestampButton(ms: number, what: string, seek: (ms: number) => void): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.contentEditable = 'false';
  button.className = 'lyrics-timestamp tabular';
  button.dataset.timestamp = String(ms);
  const clock = formatClock(ms / 1000);
  button.textContent = clock;
  button.setAttribute('aria-label', `Play ${what} from ${clock}`);
  // A press must not move the editor's selection before the click plays.
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', (event) => {
    event.preventDefault();
    seek(ms);
  });
  return button;
}

/** How the section node view reaches the seek the timestamp extension was configured with. */
export function seekThrough(storage: unknown): (ms: number) => void {
  return (ms) =>
    (storage as { lyricsTimestamps?: { seek?: (at: number) => void } }).lyricsTimestamps?.seek?.(
      ms,
    );
}
