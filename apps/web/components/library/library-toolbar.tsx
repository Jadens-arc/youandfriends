'use client';

import {
  Button,
  cn,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@youandfriends/ui';
import { LayoutGrid, List } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import {
  LIBRARY_SORTS,
  PREFERENCE_MAX_AGE_SECONDS,
  SORT_COOKIE,
  SORT_LABELS,
  VIEW_COOKIE,
  parseSort,
  type LibrarySort,
  type LibraryView,
} from '@/lib/library/sort';

export interface LibraryToolbarProps {
  readonly view: LibraryView;
  readonly sort: LibrarySort;
  /** How many projects are shown, for the count beside the controls. */
  readonly count: number;
}

function remember(name: string, value: string): void {
  // `SameSite=Lax` and path-wide: a display preference, read by the server on the next render.
  // Nothing about it is sensitive, and it carries no identifier.
  document.cookie = `${name}=${value}; Path=/; Max-Age=${PREFERENCE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

/**
 * Grid/list switching and sorting (task `041`), kept deliberately small — the default view
 * should not be overwhelmed by controls (`docs/DESIGN.md` §4).
 *
 * Each change is written to a cookie and the page is re-rendered on the server, rather than
 * re-sorted here: the server is then the one place that orders and lays out the cards, a reload
 * shows exactly what was chosen, and the first paint is already in the right layout. The
 * control reflects the choice immediately, before the refresh lands.
 */
export function LibraryToolbar({ view, sort, count }: LibraryToolbarProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [shownView, setShownView] = React.useState(view);
  const [shownSort, setShownSort] = React.useState(sort);

  function chooseView(next: LibraryView) {
    if (next === shownView) return;
    setShownView(next);
    remember(VIEW_COOKIE, next);
    startTransition(() => router.refresh());
  }

  function chooseSort(value: string) {
    const next = parseSort(value);
    setShownSort(next);
    remember(SORT_COOKIE, next);
    startTransition(() => router.refresh());
  }

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3"
      aria-busy={pending || undefined}
    >
      <p className="text-caption text-muted-foreground tabular font-sans" aria-live="polite">
        {count === 1 ? '1 project' : `${count} projects`}
      </p>
      <div className="flex items-center gap-2">
        <Select value={shownSort} onValueChange={chooseSort}>
          <SelectTrigger aria-label="Sort projects by" className="h-9 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LIBRARY_SORTS.map((option) => (
              <SelectItem key={option} value={option}>
                {SORT_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div
          role="group"
          aria-label="Layout"
          className="border-border flex rounded-md border p-0.5"
        >
          <ViewButton
            label="Grid"
            pressed={shownView === 'grid'}
            onClick={() => chooseView('grid')}
            icon={<LayoutGrid aria-hidden />}
          />
          <ViewButton
            label="List"
            pressed={shownView === 'list'}
            onClick={() => chooseView('list')}
            icon={<List aria-hidden />}
          />
        </div>
      </div>
    </div>
  );
}

function ViewButton({
  label,
  pressed,
  onClick,
  icon,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={pressed}
      onClick={onClick}
      // Pressed state is carried by `aria-pressed` and by the filled background — a shape
      // change, not a colour alone (`docs/DESIGN.md` §12).
      className={cn('gap-1.5', pressed && 'bg-card shadow-paper text-foreground')}
    >
      {icon}
      <span>{label}</span>
    </Button>
  );
}
