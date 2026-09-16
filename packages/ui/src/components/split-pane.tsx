'use client';

import * as React from 'react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus';

export interface SplitPaneProps {
  /** Left pane — the song list in the project view. */
  start: React.ReactNode;
  /** Right pane — the selected song's detail. */
  end: React.ReactNode;
  /** Percentage width of the start pane. Clamped to [minPercent, maxPercent]. */
  defaultPercent?: number;
  minPercent?: number;
  maxPercent?: number;
  /** Key under which the position is remembered, per user rather than per session. */
  storageKey?: string;
  className?: string;
  /** Accessible name for the divider, e.g. "Resize song list". */
  label: string;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/**
 * Resizable split layout for the desktop project view (docs/DESIGN.md §4).
 *
 * The divider is a real `separator` with an announced value and arrow-key resizing. A drag
 * handle that only responds to a mouse would make the layout unadjustable for keyboard users,
 * and this one persists — so an unusable default would stay unusable.
 */
export function SplitPane({
  start,
  end,
  defaultPercent = 38,
  minPercent = 22,
  maxPercent = 60,
  storageKey,
  className,
  label,
}: SplitPaneProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const draggingRef = React.useRef(false);

  /**
   * The stored position is read through `useSyncExternalStore` rather than in an effect.
   *
   * An effect that calls `setState` on mount triggers a second render pass, which React's
   * lint rules flag as cascading. `useSyncExternalStore` is built for exactly this shape:
   * an external mutable source, a server snapshot that keeps hydration consistent, and no
   * extra render. It also means a change in another tab is picked up for free.
   */
  const stored = React.useSyncExternalStore(
    React.useCallback(
      (onChange: () => void) => {
        if (!storageKey) return () => {};
        window.addEventListener('storage', onChange);
        return () => window.removeEventListener('storage', onChange);
      },
      [storageKey],
    ),
    React.useCallback(() => {
      if (!storageKey) return null;
      try {
        return window.localStorage.getItem(storageKey);
      } catch {
        // Private browsing and blocked site data both throw. A forgotten divider position
        // is not worth breaking the page over.
        return null;
      }
    }, [storageKey]),
    // Server snapshot: no storage exists, so the default is the honest answer.
    () => null,
  );

  const [override, setOverride] = React.useState<number | null>(null);

  const storedPercent = React.useMemo(() => {
    if (stored === null) return null;
    const parsed = Number.parseFloat(stored);
    return Number.isFinite(parsed) ? clamp(parsed, minPercent, maxPercent) : null;
  }, [stored, minPercent, maxPercent]);

  const percent = override ?? storedPercent ?? defaultPercent;

  const apply = React.useCallback(
    (next: number) => {
      const clamped = clamp(next, minPercent, maxPercent);
      setOverride(clamped);
      if (!storageKey) return;
      try {
        window.localStorage.setItem(storageKey, String(clamped));
      } catch {
        /* see above */
      }
    },
    [minPercent, maxPercent, storageKey],
  );

  React.useEffect(() => {
    function onMove(event: PointerEvent) {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width === 0) return;
      apply(((event.clientX - rect.left) / rect.width) * 100);
    }
    function onUp() {
      draggingRef.current = false;
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [apply]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 10 : 2;
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        apply(percent - step);
        break;
      case 'ArrowRight':
        event.preventDefault();
        apply(percent + step);
        break;
      case 'Home':
        event.preventDefault();
        apply(minPercent);
        break;
      case 'End':
        event.preventDefault();
        apply(maxPercent);
        break;
      default:
        break;
    }
  }

  return (
    <div ref={containerRef} className={cn('flex h-full w-full overflow-hidden', className)}>
      <div className="h-full min-w-0 overflow-auto" style={{ width: `${percent}%` }}>
        {start}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={Math.round(percent)}
        aria-valuemin={minPercent}
        aria-valuemax={maxPercent}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          draggingRef.current = true;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }}
        className={cn(
          'group bg-border relative w-px shrink-0 cursor-col-resize',
          // The visual line stays hairline-fine; the grab area is wider than it looks.
          'before:absolute before:inset-y-0 before:-right-1.5 before:-left-1.5 before:content-[""]',
          'hover:bg-border-strong',
          focusRing,
        )}
      />
      <div className="h-full min-w-0 flex-1 overflow-auto">{end}</div>
    </div>
  );
}
