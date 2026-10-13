# Responsive checklist

_You & Friends — a private music workspace by Avery and Friends._

The shared reference for checking every implemented flow at phone, tablet, and desktop widths
(task `101`). Task `104` walks it in a real browser, task `120`'s Playwright viewport tests
encode its structural checks, and later audits re-run it.

## Widths

| Name       | Viewport (CSS px) | Why                                                              |
| ---------- | ----------------- | ---------------------------------------------------------------- |
| iPhone SE  | 375 × 667         | The width that breaks things. Works here, works nearly anywhere. |
| iPhone Pro | 393 × 852         | Notch and home indicator: safe areas.                            |
| Tablet     | 820 × 1180        | Just past `md` (768): the desktop shell, at its narrowest.       |
| Desktop    | 1440 × 900        | The designed-for desk.                                           |

Also check each phone width in **landscape**, and every form surface with the **on-screen
keyboard raised**.

## Rules every surface is held to

1. **Touch targets.** Every interactive element below `md` is at least 44 × 44 px.
   - The `Button`, `Input`, `SelectTrigger`, menu items, and tabs primitives do it themselves:
     `max-md:min-h-11`, `max-md:size-11`, `max-md:h-11`. A test in `packages/ui` holds it.
   - A raw `<button>`, `<select>`, `<summary>`, or standalone link carries `max-md:min-h-11`.
     `min-height` does nothing on an inline element, so a link also needs `inline-flex` or
     `block`.
   - Exempt (WCAG 2.5.8): links inside a sentence, such as a song's project name in its
     header, or a target name in an activity line.
2. **No zoom on focus.** iOS Safari zooms when a field under 16 px takes focus. `globals.css`
   sets every text field, select, and editable region to at least 16 px on coarse pointers.
3. **Safe areas.**
   - The mobile header carries the top inset, and the bottom navigation the bottom inset.
   - Bottom sheets, the expanded player, the upload tray, and toasts clear the home indicator.
   - The shell's outer frame carries the left and right insets for landscape.
4. **No horizontal page scroll.** Long titles truncate (`truncate`, `min-w-0`) or wrap
   (`break-words`); the seed's long-title song is the test case.
5. **Hiding is presentation, never authorization.** A control absent at a width is still an
   endpoint the server checks.

## Flow inventory

Status: **code** — audited in source against the rules above (task `101`). **browser** —
walked at the four widths in a real browser (task `104`, pending). An unchecked box is an
unaudited flow.

| Flow                                             | Surfaces                                                    | code | browser |
| ------------------------------------------------ | ----------------------------------------------------------- | ---- | ------- |
| Sign in / sign up                                | `app/(auth)` (Clerk components)                             | [x]  | [ ]     |
| Workspace gate and first run                     | `components/workspace`                                      | [x]  | [ ]     |
| Library: folders, drill-down, breadcrumbs        | `components/library/folder-tree`, mobile drill-down         | [x]  | [ ]     |
| Library: project shelf and cards                 | `components/library`, project page                          | [x]  | [ ]     |
| Favorites, Recent, Shared, Trash                 | `app/(workspace)/{favorites,recent,shared,trash}`           | [x]  | [ ]     |
| Command palette and search                       | `components/shell/command-entry`, `app/(workspace)/search`  | [x]  | [ ]     |
| Create project / song                            | `components/library/create-dialogs`                         | [x]  | [ ]     |
| Song workspace: header, tabs, metadata           | `components/song`, `components/metadata`                    | [x]  | [ ]     |
| Versions: stack, A/B, upload a version           | `components/song/versions`, `version-selector`              | [x]  | [ ]     |
| Project Files: folders, tags, filters            | `components/song/files`                                     | [x]  | [ ]     |
| Upload: dialog, drop zone, folder review, tray   | `components/upload`                                         | [x]  | [ ]     |
| Player: bar, mini-player, expanded, queue        | `components/player`, `components/shell/mobile/mini-player`  | [x]  | [ ]     |
| Lyrics: editor, mobile full screen, history      | `components/lyrics`                                         | [x]  | [ ]     |
| Comments: general, timestamp, lyric, voice notes | `components/comments`                                       | [x]  | [ ]     |
| Mentions and reactions                           | `components/comments/mentions`, `reactions`                 | [x]  | [ ]     |
| Notifications: bell, list                        | `components/notifications`, `app/(workspace)/notifications` | [x]  | [ ]     |
| Settings: workspace, members, invitations        | `components/settings`, `app/(workspace)/settings`           | [x]  | [ ]     |
| Notification preferences, unsubscribe            | `settings/notifications`, `app/unsubscribe`                 | [x]  | [ ]     |
| Invitation acceptance                            | `app/invite/[token]`                                        | [x]  | [ ]     |
| Offline page, PWA update prompt                  | `app/offline`, `components/pwa`                             | [x]  | [ ]     |

## Per-surface checks for the browser pass

For each row above, at each width:

- [ ] Nothing scrolls horizontally (`document.documentElement.scrollWidth <= innerWidth`).
- [ ] Every control is reachable without zooming; none sits under the header, the mini-player,
      the bottom navigation, or the home indicator.
- [ ] Every interactive element measures at least 44 × 44 px below 768 px (inline links exempt).
- [ ] With the keyboard raised on any field, the field and its submit control stay visible.
- [ ] Landscape: the expanded player and the lyrics editor scroll rather than clip.

## Audit log

| Date       | Task  | Kind | Result                                                                                                                                                                                                      |
| ---------- | ----- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-13 | `101` | code | Primitives sized to 44 px below `md`; about 30 raw controls fixed; iOS focus-zoom fixed; landscape side insets added. No browser pass: sign-in is not configured in the agent environment (see task `104`). |
