import { cn } from '@youandfriends/ui';

/**
 * The large waveform that anchors the song workspace (`docs/DESIGN.md` §4).
 *
 * The region is reserved at its final size now so the page does not move when the waveform
 * itself arrives (task `072`): the header, the version selector, and the tabs are laid out
 * around a fixed-height block, whatever it ends up containing.
 *
 * Until then it says honestly what state the audio is in — never a fake waveform, which would
 * be a picture of a sound that is not this song.
 */
export const WAVEFORM_HEIGHT_CLASS = 'h-32 md:h-40';

export function WaveformRegion({
  label,
  children,
  className,
}: {
  /** The accessible name, e.g. "Waveform for Night Drive, version 3". */
  readonly label: string;
  /** What to draw inside — the waveform component (task `072`), or a status line. */
  readonly children?: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <section
      aria-label={label}
      data-testid="waveform-region"
      className={cn(
        'border-border-subtle bg-card relative flex w-full items-center justify-center overflow-hidden rounded-md border',
        WAVEFORM_HEIGHT_CLASS,
        className,
      )}
    >
      {children}
    </section>
  );
}
