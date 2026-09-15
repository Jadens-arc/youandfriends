# 121 — Accessibility audit and remediation

**Phase:** Quality, release, closeout · **Iteration:** one

## Objective

Audit the whole product against WCAG 2.2 AA and fix what fails: contrast, keyboard operation, screen-reader names, focus management, and the non-color state requirements.

## User value

The product is usable by everyone, including people navigating by keyboard or screen reader.

## Scope

- Automated auditing with axe across every implemented surface, wired into the Playwright suite.
- Manual keyboard traversal of every flow with no mouse.
- Screen-reader verification with VoiceOver on the critical paths.
- Contrast verification for every token pair and every composed surface.
- Confirmation that no state is conveyed by color alone (`docs/DESIGN.md` §12).
- Waveform keyboard and textual alternatives verified (task `072`).
- Lyrics presence announcements verified as informative without flooding (task `082`).
- Remediation of every finding, or a recorded deferral with justification.

## Non-scope

- WCAG AAA.
- Full assistive-technology matrix beyond VoiceOver and keyboard.
- Accessibility of the Tauri agent UI — covered within task `116`.

## Dependencies

`120`, `101`

## Files expected to change

```
apps/web/**
packages/ui/**
apps/web/e2e/accessibility.spec.ts
docs/ACCESSIBILITY.md
```

## Implementation notes

- Automated tools catch perhaps a third of real issues. The manual keyboard and VoiceOver passes are where the substantive findings come from — budget time for them rather than treating axe as the audit.
- Focus management is the usual failure area: dialogs, sheets, the command palette, and the expanded player all need trap-and-restore, and all were built at different times.
- 'Do not encode state by color alone' applies specifically to version state, upload state, and processing status — check each one explicitly.
- The waveform is the hardest surface. Its textual alternative (task `072`) must be genuinely usable, not a token element that technically exists.
- Record findings and remediations in `docs/ACCESSIBILITY.md` so the next audit starts from a known baseline rather than from scratch.

## Security/privacy considerations

Accessibility failures can exclude users from a product they are paying for and carry legal weight. Beyond that, focus-management bugs can strand a keyboard user in a modal with no escape, which is a genuine usability failure rather than a cosmetic one.

## Acceptance criteria

- [ ] axe runs across every implemented surface in the Playwright suite with no violations.
- [ ] Every flow is operable by keyboard alone.
- [ ] Critical paths are verified with VoiceOver.
- [ ] Every token pair and composed surface meets WCAG 2.2 AA contrast.
- [ ] No state is conveyed by color alone.
- [ ] The waveform's keyboard and textual alternatives are genuinely usable.
- [ ] Lyrics presence announcements are informative without flooding.
- [ ] Every finding is fixed or deferred with recorded justification in `docs/ACCESSIBILITY.md`.

## Tests and validation commands

```bash
pnpm test:e2e -- accessibility
pnpm release-check
```

## Manual QA

1. Complete every critical flow using only the keyboard.
2. Complete sign-in, playback, and commenting using VoiceOver.
3. Check every status indicator in greyscale to confirm non-color encoding.

## Rollback/compatibility

Fixes only. Reverting reintroduces accessibility failures.

## Status

`pending`

## Commit

_(not yet)_
