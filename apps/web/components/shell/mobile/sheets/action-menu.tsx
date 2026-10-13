'use client';

import {
  BottomSheetContent,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  focusRing,
  Sheet,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
  transition,
  useIsPhone,
} from '@youandfriends/ui';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import * as React from 'react';

/**
 * An overflow menu that is a dropdown on a desk and a bottom sheet on a phone (task `103`).
 *
 * One list of actions, two presentations: the same items in the same order, so nothing is
 * reachable at one width and not the other. On a phone each action is a full-width, 48 px row
 * in a sheet the thumb can reach — a dropdown anchored to a corner is a small target far from
 * it. The sheet is a Radix dialog, so focus is trapped while it is open and returns to the
 * trigger when it closes, by whichever path.
 */

export interface MenuAction {
  readonly key: string;
  readonly label: string;
  readonly icon?: LucideIcon;
  readonly onSelect: () => void;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  /** Draws a separator above this action. */
  readonly separated?: boolean;
}

export function ActionMenu({
  label = 'More actions',
  title,
  actions,
  trigger,
  align = 'end',
  triggerClassName,
}: {
  /** The trigger's accessible name. */
  readonly label?: string;
  /** The sheet's heading on a phone — what these actions are about. */
  readonly title: string;
  readonly actions: readonly MenuAction[];
  /** The trigger's face; a "more" icon by default. */
  readonly trigger?: React.ReactNode;
  readonly align?: 'start' | 'end';
  readonly triggerClassName?: string;
}) {
  const phone = useIsPhone();
  const [open, setOpen] = React.useState(false);
  const pending = React.useRef<(() => void) | null>(null);
  const face = trigger ?? <MoreHorizontal aria-hidden />;
  const button = (
    <Button variant="ghost" size="icon" aria-label={label} className={triggerClassName}>
      {face}
    </Button>
  );

  if (!phone) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
        <DropdownMenuContent align={align}>
          {actions.map((action) => (
            <React.Fragment key={action.key}>
              {action.separated ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                disabled={action.disabled ?? false}
                onSelect={action.onSelect}
                destructive={action.destructive ?? false}
              >
                {action.icon === undefined ? null : <action.icon aria-hidden />}
                {action.label}
              </DropdownMenuItem>
            </React.Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{button}</SheetTrigger>
      <BottomSheetContent
        aria-describedby={undefined}
        // Run the chosen action once the sheet has closed and handed focus back to the trigger,
        // so an action that opens its own dialog is not fighting this one for focus.
        onCloseAutoFocus={() => {
          const run = pending.current;
          pending.current = null;
          run?.();
        }}
      >
        <SheetTitle className="text-heading text-foreground pr-10 font-serif">{title}</SheetTitle>
        <SheetDescription className="sr-only">{label}</SheetDescription>
        <ul className="-mx-2 flex flex-col">
          {actions.map((action) => (
            <li
              key={action.key}
              className={action.separated ? 'border-border-subtle mt-1 border-t pt-1' : undefined}
            >
              <button
                type="button"
                disabled={action.disabled ?? false}
                onClick={() => {
                  pending.current = action.onSelect;
                  setOpen(false);
                }}
                className={cn(
                  'text-body hover:bg-border-subtle flex min-h-12 w-full items-center gap-3 rounded-md px-2 text-left font-sans disabled:opacity-50',
                  action.destructive ? 'text-destructive' : 'text-foreground',
                  transition,
                  focusRing,
                )}
              >
                {action.icon === undefined ? null : <action.icon aria-hidden className="size-5" />}
                {action.label}
              </button>
            </li>
          ))}
        </ul>
      </BottomSheetContent>
    </Sheet>
  );
}
