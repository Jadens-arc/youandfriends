'use client';

import {
  BottomSheetContent,
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@youandfriends/ui';
import * as React from 'react';

import { Section, States } from './scaffold';

export function Overlays() {
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [bottomSheetOpen, setBottomSheetOpen] = React.useState(false);
  const [showToasts, setShowToasts] = React.useState(true);
  const [starred, setStarred] = React.useState(true);

  return (
    <>
      <Section
        id="dialog"
        title="Dialog and sheets"
        note="Open state is the state worth seeing, so each opens from its own trigger rather than being frozen open — a frozen overlay is not the component, it is a picture of it."
      >
        <States label="Dialog" testId="showcase-dialog">
          <Dialog>
            <DialogTrigger asChild>
              <Button>Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Move to trash?</DialogTitle>
                <DialogDescription>
                  Trashed songs are recoverable for 30 days. Originals are never deleted by this
                  action.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost">Cancel</Button>
                <Button variant="destructive">Move to trash</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </States>

        <States label="Sheet — side variants" testId="showcase-sheet">
          {(['bottom', 'right', 'left', 'top'] as const).map((side) => (
            <Sheet key={side}>
              <SheetTrigger asChild>
                <Button variant="secondary">{side}</Button>
              </SheetTrigger>
              <SheetContent side={side}>
                <SheetTitle>Versions</SheetTitle>
                <SheetDescription>Three versions, newest first.</SheetDescription>
              </SheetContent>
            </Sheet>
          ))}
        </States>

        <States label="Bottom sheet — drag to dismiss" testId="showcase-bottom-sheet">
          <Button onClick={() => setBottomSheetOpen(true)}>Open bottom sheet</Button>
          <Sheet open={bottomSheetOpen} onOpenChange={setBottomSheetOpen}>
            <BottomSheetContent>
              <SheetTitle>Comments</SheetTitle>
              <SheetDescription>
                Drag the grab strip down to dismiss, or press Escape. Under reduced motion the
                settle is instant.
              </SheetDescription>
            </BottomSheetContent>
          </Sheet>
        </States>

        <States label="Sheet — controlled" testId="showcase-sheet-controlled">
          <Button variant="ghost" onClick={() => setSheetOpen(true)}>
            Open controlled sheet
          </Button>
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetContent side="right">
              <SheetTitle>File details</SheetTitle>
              <SheetDescription>Controlled by the parent, closed the same ways.</SheetDescription>
            </SheetContent>
          </Sheet>
        </States>
      </Section>

      <Section id="menu" title="Menus and tooltip">
        <States label="Dropdown menu" testId="showcase-dropdown-menu">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary">Song actions</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Blue Hour</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Rename</DropdownMenuItem>
              <DropdownMenuItem>Download original</DropdownMenuItem>
              <DropdownMenuCheckboxItem checked={starred} onCheckedChange={setStarred}>
                Favorite
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>Move to trash</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </States>

        <States label="Context menu — right-click the card" testId="showcase-context-menu">
          <ContextMenu>
            <ContextMenuTrigger className="border-border bg-card text-body text-muted-foreground flex h-24 w-56 items-center justify-center rounded-md border border-dashed font-sans">
              Right-click here
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem>Open</ContextMenuItem>
              <ContextMenuItem>Rename</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem disabled>Move to trash</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </States>

        <States label="Tooltip" testId="showcase-tooltip">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost">Hover or focus me</Button>
              </TooltipTrigger>
              <TooltipContent>Plays from the current version</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </States>
      </Section>

      <Section
        id="command"
        title="Command palette"
        note="Rendered inline rather than in its dialog, so the list, the groups, and the empty state are all visible at once."
      >
        <States label="With results" testId="showcase-command" className="!items-start">
          <Command className="border-border h-72 w-80 rounded-md border">
            <CommandInput placeholder="Search songs, folders, lyrics…" />
            <CommandList>
              <CommandEmpty>Nothing matches.</CommandEmpty>
              <CommandGroup heading="Songs">
                <CommandItem>Blue Hour</CommandItem>
                <CommandItem>Second Sleep</CommandItem>
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="Actions">
                <CommandItem>
                  New song
                  <CommandShortcut>⌘N</CommandShortcut>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>

          <Command className="border-border h-72 w-80 rounded-md border">
            <CommandInput placeholder="Empty state" value="zzzzzz" onValueChange={() => {}} />
            <CommandList>
              <CommandEmpty>Nothing matches.</CommandEmpty>
            </CommandList>
          </Command>
        </States>
      </Section>

      <Section id="toast" title="Toast">
        <States label="Variants" testId="showcase-toast" className="!items-start">
          <Button variant="ghost" onClick={() => setShowToasts((value) => !value)}>
            {showToasts ? 'Hide toasts' : 'Show toasts'}
          </Button>
          <ToastProvider duration={Infinity}>
            <Toast open={showToasts} variant="neutral">
              <div className="flex-1">
                <ToastTitle>Upload complete</ToastTitle>
                <ToastDescription>Blue Hour — version 3</ToastDescription>
              </div>
              <ToastClose />
            </Toast>
            <Toast open={showToasts} variant="problem">
              <div className="flex-1">
                <ToastTitle>Upload failed</ToastTitle>
                <ToastDescription>The connection dropped at 40%.</ToastDescription>
              </div>
              <ToastAction altText="Retry the upload">Retry</ToastAction>
              <ToastClose />
            </Toast>
            <ToastViewport />
          </ToastProvider>
        </States>
      </Section>
    </>
  );
}
