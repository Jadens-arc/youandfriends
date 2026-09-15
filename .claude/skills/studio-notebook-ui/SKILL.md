---
name: studio-notebook-ui
description: Tokens, typography, responsive patterns, accessibility, and visual QA for the Studio Notebook system. Use for any UI work in packages/ui or apps/web components.
---

# Studio Notebook UI

Keeps You & Friends feeling like a warm studio notebook rather than a beige productivity
template — and keeps it usable by everyone.

## When to use

Any change to `packages/ui/**` or presentation in `apps/web/components/**`.

## Steps

### 1. Read the specification

`docs/DESIGN.md` §11 (visual system) and §12 (accessibility). Every time, not from memory.

### 2. Use tokens, never raw colors

```bash
grep -rnE '#[0-9a-fA-F]{3,8}\b|rgba?\(' packages/ui/src/components apps/web/components
```

Any hit outside `tokens.css` is a lint failure. Colors are defined once.

Token families: canvas, raised paper, espresso, ink, secondary text, olive, rust, ochre,
border-at-opacity.

### 3. Shape and elevation

- Radii mostly **8–14 px**. Avoid pill shapes — fully rounded controls read as generic SaaS.
- Fine warm borders, restrained shadows tinted with ink rather than pure black.
- Dark controls may use soft inset highlights.
- Artwork square with modest rounding, never overlaid with heavy text.

### 4. Typography

- Editorial serif for titles and major headings.
- Neutral sans for controls, navigation, metadata, dense lists.
- Restrained monospace for lyrics and timestamps.
- **Tabular figures** for timestamps and durations, or digits jitter during playback.

### 5. Motion

150–220 ms for navigation and controls. Gentle spring for bottom sheets. Linear and precise
for waveform and playhead. All motion tokens resolve to zero under `prefers-reduced-motion`.

### 6. Contrast

Verify every text-on-surface pair you introduce or change against WCAG 2.2 AA. This is a
gate, not a guideline — run it before you like how it looks, because contrast decides the
final values.

```bash
pnpm --filter @youandfriends/ui test -- contrast
```

### 7. Keyboard and focus

- Tab through what you built. Every interactive element reachable, in a logical order.
- Focus ring visible on **both** cream and espresso surfaces — two treatments, resolved by
  token.
- Dialogs and sheets trap focus and restore it to the trigger on close.
- Never remove a focus ring for a visual result.

### 8. State is never color alone

Version state, upload state, and processing status each pair color with text or an icon.
Check in greyscale.

### 9. Responsive

Verify at 375 px (iPhone SE), iPhone Pro, tablet, desktop. Portrait and landscape. With the
on-screen keyboard raised on form surfaces.

44×44 px minimum for every mobile-visible control. Expand hit areas with pseudo-elements so
touch targets grow without inflating dense desktop layouts.

### 10. Visual QA

Check the component showcase at `/_showcase` — every state of every primitive in one place.

## Stop conditions

- A design requirement conflicts with an accessibility requirement. Raise it; accessibility
  wins by default but the user should know.
- The only way to achieve a visual result is a raw color, a removed focus ring, or color-only
  state.
- A token would need to be added that duplicates an existing one.

## Output

```
SURFACE: <what changed>
TOKENS: <used> · added: <names + justification | none>
RAW COLORS: none — grep clean
RADII: <values> (8–14 px band)
TYPOGRAPHY: <faces used> · tabular figures where numeric
CONTRAST: <pair>: <ratio> AA pass|fail (one line each)
KEYBOARD: <path verified> · focus visible on cream|espresso
FOCUS TRAP: <dialogs/sheets> restore to trigger — verified|n/a
COLOR-ONLY STATE: none — greyscale checked
VIEWPORTS: 375|Pro|tablet|desktop · portrait|landscape · keyboard raised
REDUCED MOTION: verified
```
