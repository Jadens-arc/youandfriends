# 074 — Loop regions and playback speed

**Phase:** Persistent player · **Iteration:** one

## Objective

Add whole-track loop, in/out loop regions selectable on the waveform, and playback speed control with pitch preservation.

## User value

Looping a two-bar section while writing to it, or slowing a fast passage down to catch what is actually being played.

## Scope

- Whole-track loop toggle.
- In/out loop region with markers draggable on the waveform and settable from the current playhead.
- Loop region persisted per song per user.
- Playback speed control (0.5× to 2×) with pitch preservation.
- Keyboard shortcuts for setting loop in, loop out, and clearing.
- Clear visual indication of an active loop region on the waveform.

## Non-scope

- Beat detection or tempo-aware looping.
- Pitch shifting independent of speed.
- Loop regions shared between collaborators.

## Dependencies

`072`, `073`

## Files expected to change

```
apps/web/lib/player/loop.ts
apps/web/components/player/loop-controls.tsx
apps/web/components/player/waveform/loop-region.tsx
apps/web/lib/player/__tests__/loop.test.ts
```

## Implementation notes

- `preservesPitch` on the audio element handles pitch preservation natively in modern browsers. Check support and degrade honestly rather than implementing a Web Audio pitch shifter, which would cost us the native playback benefits (ADR 0004).
- Loop boundary handling must be tight — checking `timeupdate` alone is too coarse (it fires ~4× per second) and produces an audibly sloppy loop. Use `requestAnimationFrame` for the boundary check.
- Loop regions are per user per song: two collaborators looping different sections must not interfere.
- Setting loop points from the playhead is the fast path in practice; keyboard shortcuts for in and out matter more than drag precision.
- The loop region must be visible on the waveform without obscuring the audio shape.

## Security/privacy considerations

Loop and speed are local playback state with no authorization implications. Persisted per-user loop regions are scoped to the user and the song and are subject to the same access checks when loaded.

## Acceptance criteria

- [ ] Whole-track loop works.
- [ ] In/out loop regions can be set by drag and from the playhead, and cleared.
- [ ] Loop boundaries are tight, not audibly sloppy.
- [ ] Loop regions persist per song per user and do not leak between collaborators.
- [ ] Speed from 0.5× to 2× works with pitch preserved where supported, and degrades honestly where not.
- [ ] Keyboard shortcuts exist for loop in, loop out, and clear.
- [ ] The active loop region is clearly visible without obscuring the waveform.

## Tests and validation commands

```bash
pnpm --filter web test
```

## Manual QA

1. Set a two-second loop and confirm it repeats tightly.
2. Play at 0.5× and confirm pitch is preserved.
3. Set loop points by keyboard only.

## Rollback/compatibility

Additive. Reverting loses loop and speed; core playback is unaffected.

## Status

`pending`

## Commit

_(not yet)_
