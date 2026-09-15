# 100 — PWA manifest, icons, and installability

**Phase:** Mobile and PWA · **Iteration:** one

## Objective

Make You & Friends installable on iPhone: web app manifest, icons, splash screens, theme colors, and a service worker registered with a safe caching strategy.

## User value

An app icon on the Home Screen that opens straight into the workspace.

## Scope

- Web app manifest with the You & Friends name, short name, and theme colors from the Studio Notebook palette.
- Icon set at every required size, plus iOS-specific touch icons and splash screens.
- Service worker registration with a conservative caching strategy for the app shell.
- An install prompt where the platform supports it, and clear iOS instructions where it does not.
- Standalone display mode with correct status bar treatment.
- Versioned service worker updates that do not strand users on stale assets.

## Non-scope

- Offline content caching (deferred `203`).
- Web Push (deferred `210`).
- Background sync — unreliable on iOS; do not claim it.

## Dependencies

`014`, `010`

## Files expected to change

```
apps/web/public/manifest.webmanifest
apps/web/public/icons/**
apps/web/app/sw.ts
apps/web/app/layout.tsx
docs/OPERATIONS.md
```

## Implementation notes

- The display name is **You & Friends** with the ampersand. In the manifest JSON it is a plain string; in HTML contexts it must be escaped as `&amp;` (`docs/DESIGN.md` §16).
- iOS ignores much of the standard manifest and needs `apple-touch-icon` links and splash screen meta tags generated per device size. Generate them; do not hand-maintain.
- Cache the app shell only in this task. Caching authorized media without an authorization story is a data-leak risk — offline content is deferred to task `203` deliberately.
- Service worker updates must not strand users. Use a skip-waiting flow with a visible 'new version available' prompt rather than silently serving stale assets for days.
- iOS has no `beforeinstallprompt`. Provide honest Add-to-Home-Screen instructions rather than a button that does nothing (`docs/OPERATIONS.md` §9).

## Security/privacy considerations

A service worker is a powerful interception point. Scope it correctly, never cache authorized API responses or media in this task, and ensure cached shell assets contain no user data. A cached response served to a different user on a shared device would be a serious leak — which is why content caching waits for task `203`'s explicit authorization design.

## Acceptance criteria

- [ ] The manifest carries the You & Friends name, correctly escaped in HTML contexts.
- [ ] Icons and splash screens exist for all required sizes including iOS-specific ones.
- [ ] A service worker registers and caches only app shell assets.
- [ ] No authorized API responses or media are cached in this task.
- [ ] Install works on supported platforms; iOS gets honest instructions.
- [ ] Standalone mode renders with correct status bar treatment.
- [ ] Service worker updates prompt rather than stranding users on stale assets.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm build
# Lighthouse PWA installability audit
```

## Manual QA

1. Add to Home Screen on an iPhone; confirm icon, splash, and standalone launch.
2. Deploy an update and confirm the new-version prompt appears.
3. Inspect Cache Storage and confirm no user content is cached.

## Rollback/compatibility

Additive. Reverting removes installability. A deployed service worker must be unregistered carefully — document the kill-switch procedure in `docs/OPERATIONS.md`.

## Status

`pending`

## Commit

_(not yet)_
