/// <reference lib="dom" />
// This file runs in jsdom. `packages/config` is otherwise a server-side package, so the DOM
// lib is referenced here rather than widened across the whole package.

import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * jsdom implements a subset of the DOM. Radix primitives use a few APIs it lacks, and
 * without them the component throws rather than rendering — which looks like a component
 * bug when it is a harness gap. These are minimal, honest stand-ins, not behaviour fakes:
 * they let the component mount so the real assertions (roles, keyboard, focus) can run.
 */
const globals = globalThis as unknown as Record<string, unknown>;

if (!('ResizeObserver' in globalThis)) {
  globals.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

if (!('DOMRect' in globalThis)) {
  globals.DOMRect = class {
    constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0,
    ) {}
    get top(): number {
      return this.y;
    }
    get left(): number {
      return this.x;
    }
    get right(): number {
      return this.x + this.width;
    }
    get bottom(): number {
      return this.y + this.height;
    }
    toJSON(): object {
      return { ...this };
    }
    static fromRect(rect?: { x?: number; y?: number; width?: number; height?: number }) {
      return new (
        globals.DOMRect as new (x?: number, y?: number, w?: number, h?: number) => unknown
      )(rect?.x, rect?.y, rect?.width, rect?.height);
    }
  };
}

/**
 * jsdom has no PointerEvent. Radix menus dispatch and listen for them, so without this a
 * menu never opens and the test times out rather than failing with a useful message.
 */
if (!('PointerEvent' in globalThis)) {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
      this.pointerType = params.pointerType ?? 'mouse';
      this.isPrimary = params.isPrimary ?? true;
    }
  }
  globals.PointerEvent = PointerEventPolyfill;
}

if (typeof document !== 'undefined') {
  document.elementFromPoint ??= function elementFromPoint(): Element | null {
    return document.body;
  };
}

// Radix uses these for positioning and pointer capture; jsdom provides neither.
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView ??= function scrollIntoView(): void {};
  Element.prototype.hasPointerCapture ??= function hasPointerCapture(): boolean {
    return false;
  };
  Element.prototype.setPointerCapture ??= function setPointerCapture(): void {};
  Element.prototype.releasePointerCapture ??= function releasePointerCapture(): void {};
}

/**
 * Unmount between tests, then undo what dismissible layers leave behind.
 *
 * Radix's scroll-lock sets `pointer-events: none` on `<body>` and marks sibling content
 * `aria-hidden` while a dialog or sheet is open. React Testing Library's `cleanup` unmounts
 * the tree but does not always revert those, so a later test in the same file renders into a
 * document where nothing can be interacted with and every query times out. The symptom is
 * baffling — components that pass in isolation hang only when a dialog test ran first — so
 * this resets the document explicitly rather than leaving it to chance.
 */
afterEach(() => {
  cleanup();

  if (typeof document === 'undefined') return;

  document.body.removeAttribute('style');
  document.body.removeAttribute('aria-hidden');
  document.body.removeAttribute('data-scroll-locked');
  document.documentElement.removeAttribute('style');

  for (const element of Array.from(document.querySelectorAll('[aria-hidden="true"]'))) {
    // Radix marks background content inert while a layer is open. Anything still marked
    // after unmount is residue, not intent.
    if (element.parentElement === document.body) element.removeAttribute('aria-hidden');
  }

  /**
   * Remove leftover portal containers.
   *
   * Radix portals mount directly to `<body>`, outside the container React Testing Library
   * created and therefore outside what its `cleanup` removes. They accumulate across tests,
   * and each surviving container makes the next mount measurably slower — in this suite the
   * per-test cost climbed 3s, 7s, 13s, 13s until the fifth exceeded the timeout. Left
   * unfixed it looks like a flaky component; it is leaked DOM.
   */
  for (const node of Array.from(document.body.children)) {
    if (node.hasAttribute('data-radix-popper-content-wrapper') || node.tagName === 'ASIDE') {
      node.remove();
      continue;
    }
    // RTL's own containers are removed by cleanup(); anything else left directly on body
    // after unmount is portal residue.
    if (node.tagName === 'DIV' && node.childElementCount === 0 && !node.hasAttribute('id')) {
      node.remove();
    }
  }
});
