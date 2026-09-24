import { cn } from '@youandfriends/ui';

import type { CoverSource } from '@/lib/library/covers';
import { initialsOf, stableIndex } from '@/lib/library/format';

/**
 * The placeholder tints, one per accent. Each pairs a pale ground with that accent's AA-safe
 * text variant — never the decorative accent itself for the letters.
 */
const TINTS = [
  { ground: 'bg-olive/20', ink: 'text-olive-text', groove: 'border-olive-text/20' },
  { ground: 'bg-rust/20', ink: 'text-rust-text', groove: 'border-rust-text/20' },
  { ground: 'bg-ochre/25', ink: 'text-ochre-text', groove: 'border-ochre-text/20' },
] as const;

export type { CoverSource } from '@/lib/library/covers';

export interface CoverArtProps {
  readonly id: string;
  readonly name: string;
  readonly cover: CoverSource | null;
  /** The `sizes` attribute for the layout this cover sits in. */
  readonly sizes: string;
  readonly className?: string;
}

/**
 * Square cover art with modest rounding (`docs/DESIGN.md` §11), or the considered placeholder
 * the task notes ask for when there is none — which, early on, is most projects.
 *
 * The artwork carries the card: no text is ever laid over a real cover. The placeholder is the
 * exception only because it *is* type: the project's initials, set in the editorial serif on
 * one of the three accent tints, inside a faint record groove. Decorative either way — the
 * card names the project in text right beside it, so this is hidden from assistive technology.
 *
 * `srcSet` and `sizes` are required together whenever a real cover arrives (task `069`): a grid
 * of full-resolution originals is the easiest performance mistake available here.
 */
export function CoverArt({ id, name, cover, sizes, className }: CoverArtProps) {
  const base = cn(
    'border-border-subtle relative aspect-square w-full overflow-hidden rounded-md border',
    className,
  );

  if (cover !== null) {
    return (
      // A plain `img`, not `next/image`: the renditions are already sized server-side (task
      // `069`), and the image optimizer would resize them a second time.
      <img
        src={cover.src}
        srcSet={cover.srcSet}
        sizes={sizes}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn(base, 'bg-card object-cover')}
      />
    );
  }

  const tint = TINTS[stableIndex(id, TINTS.length)] ?? TINTS[0];
  return (
    <div
      aria-hidden
      className={cn(base, tint.ground, '@container flex items-center justify-center')}
    >
      <div
        className={cn(
          'absolute inset-[14%] rounded-full border',
          tint.groove,
          'after:absolute after:inset-[28%] after:rounded-full after:border after:border-inherit',
        )}
      />
      <span className={cn('relative font-serif text-[clamp(1.25rem,28cqi,3rem)]', tint.ink)}>
        {initialsOf(name)}
      </span>
    </div>
  );
}
