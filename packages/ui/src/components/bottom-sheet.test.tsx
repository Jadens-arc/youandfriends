import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BottomSheetContent, DISMISS_DISTANCE } from './bottom-sheet';
import { Button } from './button';
import { Sheet, SheetTitle, SheetTrigger } from './sheet';

function Example() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button>Versions</Button>
      </SheetTrigger>
      <BottomSheetContent>
        <SheetTitle>Versions</SheetTitle>
      </BottomSheetContent>
    </Sheet>
  );
}

async function open() {
  const user = userEvent.setup();
  render(<Example />);
  await user.click(screen.getByRole('button', { name: 'Versions' }));

  const sheet = await screen.findByRole('dialog');
  const handle = sheet.querySelector('[data-drag-handle]');
  if (!(handle instanceof HTMLElement)) throw new Error('drag handle missing');
  return { handle, sheet, user };
}

/**
 * A drag of `distance` px over `duration` ms, as a pointer would produce it.
 *
 * The clock is frozen rather than advanced, because `fireEvent` ignores a `timeStamp` in its
 * init dict — jsdom stamps the event itself — so elapsed time has to come from the clock the
 * component reads.
 */
function drag(handle: HTMLElement, distance: number, duration = 400) {
  const start = performance.now();
  const clock = vi.spyOn(performance, 'now').mockReturnValue(start);

  fireEvent.pointerDown(handle, { pointerId: 1, isPrimary: true, button: 0, clientY: 0 });
  fireEvent.pointerMove(handle, { pointerId: 1, isPrimary: true, clientY: distance });

  clock.mockReturnValue(start + duration);
  fireEvent.pointerUp(handle, { pointerId: 1, isPrimary: true, clientY: distance });

  clock.mockRestore();
}

/** Make `matchMedia` answer for one query, as a viewer's motion preference would. */
function setReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BottomSheetContent', () => {
  it('follows the pointer while dragging', async () => {
    const { handle, sheet } = await open();

    fireEvent.pointerDown(handle, { pointerId: 1, isPrimary: true, button: 0, clientY: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, isPrimary: true, clientY: 40 });

    expect(sheet.style.transform).toBe('translateY(40px)');
    expect(sheet).toHaveAttribute('data-dragging');
  });

  it('resists upward drag instead of refusing it', async () => {
    const { handle, sheet } = await open();

    fireEvent.pointerDown(handle, { pointerId: 1, isPrimary: true, button: 0, clientY: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, isPrimary: true, clientY: -40 });

    // A quarter of the movement: the sheet gives, but does not leave the bottom edge.
    expect(sheet.style.transform).toBe('translateY(-10px)');
  });

  it('settles back when the drag falls short', async () => {
    const { handle, sheet } = await open();
    drag(handle, DISMISS_DISTANCE - 1);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(sheet.style.transform).toBe('');
    expect(sheet).not.toHaveAttribute('data-dragging');
  });

  it('dismisses when the drag passes the threshold', async () => {
    const { handle } = await open();
    drag(handle, DISMISS_DISTANCE + 1);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('dismisses a short flick, which distance alone would reject', async () => {
    const { handle } = await open();
    // 60px in 40ms — 1.5 px/ms. A haul of the same distance settles back.
    drag(handle, 60, 40);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('ignores a secondary button', async () => {
    const { handle, sheet } = await open();

    fireEvent.pointerDown(handle, { pointerId: 1, isPrimary: true, button: 2, clientY: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, isPrimary: true, clientY: 200 });

    expect(sheet.style.transform).toBe('');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('still dismisses from the keyboard, and restores focus to the trigger', async () => {
    const { user } = await open();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Versions' })).toHaveFocus();
  });

  it('restores focus to the trigger after a drag dismissal too', async () => {
    const { handle } = await open();
    drag(handle, DISMISS_DISTANCE + 1);

    // Drag goes through a real Dialog.Close rather than flipping state, precisely so this
    // holds without the gesture reimplementing Radix's teardown.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Versions' })).toHaveFocus());
  });

  it('exposes only one close control to assistive technology', async () => {
    await open();
    // The drag path's Close is hidden; a second "Close" in the accessibility tree would be
    // a duplicate with no meaning to a screen-reader user.
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
  });

  it('springs on the settle when motion is allowed', async () => {
    setReducedMotion(false);
    const { sheet } = await open();

    expect(sheet.className).toMatch(/--ease-spring/);
    expect(sheet.className).toMatch(/--duration-slow/);
  });

  it('snaps instead of springing under reduced motion', async () => {
    setReducedMotion(true);
    const { sheet, handle } = await open();

    expect(sheet.className).not.toMatch(/--ease-spring/);

    // Direct manipulation is not animation: the sheet still follows the finger.
    fireEvent.pointerDown(handle, { pointerId: 1, isPrimary: true, button: 0, clientY: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, isPrimary: true, clientY: 30 });
    expect(sheet.style.transform).toBe('translateY(30px)');
  });

  it('claims the vertical gesture on the handle only', async () => {
    const { handle, sheet } = await open();

    // `touch-none` on the whole surface would break scrolling inside the sheet.
    expect(handle.className).toMatch(/touch-none/);
    expect(sheet.className).not.toMatch(/touch-none/);
  });
});
