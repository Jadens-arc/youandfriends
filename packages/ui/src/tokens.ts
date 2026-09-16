/**
 * Studio Notebook foundation tokens.
 *
 * The single source of truth for the palette. `styles/tokens.css` mirrors these values, and
 * a test asserts the two cannot drift.
 *
 * Values follow the direction in docs/DESIGN.md §11, tuned for contrast. The spec says the
 * exact colours should be tuned during implementation while preserving the relationships —
 * contrast is what decided the final values, not preference.
 *
 * **Accents come in two forms.** The base value is the designed colour, for fills and
 * decoration. The `-text` variant is darkened until it clears WCAG 2.2 AA (4.5:1) on the
 * canvas. Using the base value for text would fail at 2.2–2.9:1, so the split is not
 * optional — it is what lets the palette stay warm without becoming unreadable.
 */

/** Surfaces. */
export const surface = {
  /** Warm cream page canvas. */
  canvas: '#F3EEE3',
  /** Lighter cream for raised paper: cards, sheets, popovers. */
  paper: '#F8F4EA',
  /** Deep espresso for the navigation rail and the player. */
  espresso: '#2A1F18',
} as const;

/** Text. */
export const text = {
  /** Ink brown-black. 14.5:1 on canvas. */
  ink: '#241C17',
  /** Warm gray-brown for secondary text on light surfaces. 4.6:1 on canvas. */
  secondary: '#746A60',
  /** Secondary text on espresso surfaces. 4.68:1 — the light-surface value fails there. */
  secondaryOnEspresso: '#918981',
  /** Primary text on espresso surfaces. */
  onEspresso: '#F3EEE3',
} as const;

/** Accents. Base for fills and decoration; `*Text` for anything carrying words. */
export const accent = {
  olive: '#899078',
  oliveText: '#696F5C',
  rust: '#C98267',
  rustText: '#935F4B',
  ochre: '#B6A268',
  ochreText: '#786B45',
} as const;

/**
 * Borders: ink at low opacity, so a border tints with whatever it sits on rather than
 * cutting a grey line across a warm surface.
 */
export const border = {
  subtle: 'rgb(36 28 23 / 0.10)',
  DEFAULT: 'rgb(36 28 23 / 0.14)',
  strong: 'rgb(36 28 23 / 0.28)',
  onEspresso: 'rgb(243 238 227 / 0.14)',
} as const;

/** Corner radii. Mostly 8–14 px — pill shapes read as generic SaaS (docs/DESIGN.md §11). */
export const radius = {
  sm: '8px',
  DEFAULT: '10px',
  md: '12px',
  lg: '14px',
  /** Reserved for genuinely circular elements: avatars, the play button. */
  full: '9999px',
} as const;

/** Elevation. Shadows are ink-tinted, never neutral black. */
export const shadow = {
  paper: '0 1px 2px rgb(36 28 23 / 0.06)',
  raised: '0 2px 8px rgb(36 28 23 / 0.08)',
  overlay: '0 8px 24px rgb(36 28 23 / 0.12)',
  /** Soft inset highlight for dark controls on espresso. */
  inset: 'inset 0 1px 0 rgb(243 238 227 / 0.08)',
} as const;

/** Motion. 150–220 ms for navigation and controls; reduced-motion collapses these to 0. */
export const motion = {
  fast: '150ms',
  DEFAULT: '180ms',
  slow: '220ms',
  easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
  /** Gentle spring for bottom sheets. */
  spring: 'cubic-bezier(0.34, 1.26, 0.64, 1)',
} as const;

/**
 * Every text-on-surface pair the system promises is accessible.
 * The contrast test enumerates exactly this list, so adding a pair here without meeting AA
 * fails the build.
 */
export const TEXT_ON_SURFACE_PAIRS: ReadonlyArray<{
  name: string;
  foreground: string;
  background: string;
}> = [
  { name: 'ink on canvas', foreground: text.ink, background: surface.canvas },
  { name: 'ink on paper', foreground: text.ink, background: surface.paper },
  { name: 'secondary on canvas', foreground: text.secondary, background: surface.canvas },
  { name: 'secondary on paper', foreground: text.secondary, background: surface.paper },
  { name: 'primary on espresso', foreground: text.onEspresso, background: surface.espresso },
  {
    name: 'secondary on espresso',
    foreground: text.secondaryOnEspresso,
    background: surface.espresso,
  },
  { name: 'olive text on canvas', foreground: accent.oliveText, background: surface.canvas },
  { name: 'olive text on paper', foreground: accent.oliveText, background: surface.paper },
  { name: 'rust text on canvas', foreground: accent.rustText, background: surface.canvas },
  { name: 'rust text on paper', foreground: accent.rustText, background: surface.paper },
  { name: 'ochre text on canvas', foreground: accent.ochreText, background: surface.canvas },
  { name: 'ochre text on paper', foreground: accent.ochreText, background: surface.paper },
];

export const tokens = { surface, text, accent, border, radius, shadow, motion } as const;
