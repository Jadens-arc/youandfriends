/**
 * Shared interaction classes.
 *
 * Focus visibility and hit-target size are accessibility requirements from
 * `docs/DESIGN.md` §12 and §10, not per-component styling choices. Centralising them means a
 * new primitive gets them by composition rather than by the author remembering.
 */

/**
 * Visible focus ring for light (cream/paper) surfaces.
 *
 * `focus-visible` rather than `focus`, so a mouse click does not leave a ring behind while
 * keyboard navigation still does.
 */
export const focusRing =
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/**
 * Focus ring for espresso surfaces — the navigation rail and the player.
 *
 * The ink-coloured ring disappears against espresso, so dark surfaces need their own. This
 * is the second treatment promised in task `010`, not a variant for convenience.
 */
export const focusRingOnEspresso =
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-on-espresso';

/**
 * Expand a control's touch target to at least 44×44 px without changing its visual size.
 *
 * `docs/DESIGN.md` §10 requires 44×44 on mobile. Padding the element would inflate dense
 * desktop lists, so the target grows through a pseudo-element instead.
 */
export const touchTarget =
  "relative after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] md:after:hidden";

/** Applied to every interactive primitive so a disabled control reads as disabled. */
export const disabledState = 'disabled:pointer-events-none disabled:opacity-50';

/** Standard transition, honouring the reduced-motion collapse in the token layer. */
export const transition =
  'transition-[color,background-color,border-color,box-shadow,opacity] [transition-duration:var(--duration)] [transition-timing-function:var(--ease-notebook)]';
