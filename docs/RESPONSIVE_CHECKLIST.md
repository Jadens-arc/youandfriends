# Responsive checklist

The audit task `101` asks for, kept here so task `120`'s Playwright viewport tests and every
later audit work from the same list. **Work from this list, not from memory**: an unaudited flow
is an unaudited flow.

## Widths

| Name       | Viewport (CSS px) | Pointer | Why                                                 |
| ---------- | ----------------- | ------- | --------------------------------------------------- |
| iPhone SE  | 375 × 667         | coarse  | The width that breaks things.                       |
| iPhone Pro | 393 × 852         | coarse  | The common phone; has a notch and a home indicator. |
| Tablet     | 820 × 1180        | coarse  | Above the `md` breakpoint, but still a thumb.       |
| Desktop    | 1280 × 800        | fine    | The reference layout.                               |

Each flow is also checked in **landscape** on a phone (667 × 375), and every form surface is
checked **with the on-screen keyboard raised**. A narrow window is not a raised keyboard.

## The rules every screen is held to

1. **No horizontal scroll** of the page at any width. `document.documentElement.scrollWidth`
   must not exceed the viewport width.
2. **Every interactive element is at least 44 × 44 px on a phone or a touch tablet.** This is
   enforced at the base, and then checked:
   - `Button`: each size has a floor on phones (`packages/ui/src/components/button.tsx`).
   - Every `button`, `select`, `summary`, text `input`, and button-like role gets the floor on
     narrow screens _and_ on any coarse pointer. The rule is in `apps/web/app/globals.css`.
   - Links and labels standing on their own use `touch-target`; blocks that lay out their own
     content use `touch-height`. Both are defined under the same rule.
   - **Exempt:** a target inside a line of text, such as a mention in a comment or a comment marker in
     the lyrics (WCAG 2.5.5's inline exception). It carries `data-inline-target`. A link inside a
     sentence (an activity line's song title, a song header's project name) is exempt the same
     way.
3. **Safe areas.** Anything fixed to the top or bottom edge pads by `env(safe-area-inset-*)`:
   the mobile header, the bottom navigation (the mini-player sits above it), the expanded player,
   the upload tray, and the docked lyrics toolbar while it rests on the screen's edge. That last
   one was missing and was fixed in task `101`.
4. **Hiding is presentation, never authorization.** A control absent at a width is still an
   endpoint, refused by the server if the person may not use it.
5. **Truncation, not overflow.** Long titles and names end in an ellipsis. The seeded song
   _A Reasonably Long Song Title…_ exists to check this.

## Flow inventory

Each row is checked at every width above. ✅ means measured in a real browser, ◻︎ means not yet.

| Flow                       | Route / surface                                       | 375 | 393 | 820 | 1280 | Landscape | Keyboard |
| -------------------------- | ----------------------------------------------------- | --- | --- | --- | ---- | --------- | -------- |
| Sign in, sign up           | `/sign-in`, `/sign-up`                                | ◻︎   | ◻︎   | ◻︎   | ◻︎    | ◻︎         | ◻︎        |
| Accept an invitation       | `/invite/[token]`                                     | ◻︎   | ◻︎   | ◻︎   | ◻︎    | —         | —        |
| Library home and modules   | `/`                                                   | ◻︎   | ◻︎   | ◻︎   | ◻︎    | —         | —        |
| Folders and breadcrumbs    | `/library/…`, mobile drill-down, move / name dialogs  | ◻︎   | ◻︎   | ◻︎   | ◻︎    | —         | ◻︎        |
| Project and its files      | `/projects/[id]`, Project Files, folder upload review | ◻︎   | ◻︎   | ◻︎   | ◻︎    | —         | ◻︎        |
| Song overview and versions | `/songs/[id]`, version selector, version actions      | ◻︎   | ◻︎   | ◻︎   | ◻︎    | ◻︎         | ◻︎        |
| Upload                     | Upload dialog, drop zone, upload tray                 | ◻︎   | ◻︎   | ◻︎   | ◻︎    | —         | ◻︎        |
| Player                     | Mini-player, expanded player, queue, loop controls    | ◻︎   | ◻︎   | ◻︎   | ◻︎    | ◻︎         | —        |
| Waveform and moments       | Waveform, comment markers, "comment at the playhead"  | ◻︎   | ◻︎   | ◻︎   | ◻︎    | ◻︎         | ◻︎        |
| Lyrics                     | `?tab=lyrics`, full-screen editor, history, anchors   | ◻︎   | ◻︎   | ◻︎   | ◻︎    | ◻︎         | ◻︎        |
| Comments                   | `?tab=activity`, mentions, reactions, voice notes     | ◻︎   | ◻︎   | ◻︎   | ◻︎    | —         | ◻︎        |
| Notifications              | Bell, `/notifications`                                | ◻︎   | ◻︎   | ◻︎   | ◻︎    | —         | —        |
| Search                     | Command entry, `/search`                              | ◻︎   | ◻︎   | ◻︎   | ◻︎    | —         | ◻︎        |
| Recent, favourites, shared | `/recent`, `/favorites`, `/shared`                    | ◻︎   | ◻︎   | ◻︎   | ◻︎    | —         | —        |
| Trash                      | `/trash`                                              | ◻︎   | ◻︎   | ◻︎   | ◻︎    | —         | —        |
| Settings                   | `/settings`, `/settings/members`, invite form         | ◻︎   | ◻︎   | ◻︎   | ◻︎    | —         | ◻︎        |
| Notification preferences   | `/settings/notifications`                             | ◻︎   | ◻︎   | ◻︎   | ◻︎    | —         | —        |
| Unsubscribe                | `/unsubscribe`                                        | ◻︎   | ◻︎   | ◻︎   | ◻︎    | —         | —        |
| Offline fallback           | `/offline`                                            | ◻︎   | ◻︎   | ◻︎   | ◻︎    | —         | —        |

**Why the table is still unticked.** Every route except the last three needs a signed-in Clerk
session, and task `101`'s pass ran where none could be made. What was measured instead is below.
Ticking a row means opening it in a real browser at that width, with the rules above.

## What was measured (task `101`)

The production CSS build (`pnpm --filter web build`) loaded into a page of representative
controls, measured in Chromium with Playwright at the four widths. The controls were:

- each `Button` size
- a raw `button`, a `select`, a `summary`, and a text `input`
- an inline mention
- a checkbox's `touch-target` label
- a breadcrumb link, including a long truncating one

| Control                   | 375       | 393       | 820 (touch) | 1280 (mouse) |
| ------------------------- | --------- | --------- | ----------- | ------------ |
| `Button` sm               | 45 × 44   | 45 × 44   | 45 × 44     | 45 × 32      |
| `Button` icon             | 44 × 44   | 44 × 44   | 44 × 44     | 36 × 36      |
| raw `button`              | 51 × 44   | 51 × 44   | 51 × 44     | 51 × 32      |
| `select`                  | 93 × 44   | 93 × 44   | 93 × 44     | 93 × 36      |
| `summary`                 | full × 44 | full × 44 | full × 44   | full × 24    |
| text `input`              | 218 × 44  | 218 × 44  | 218 × 44    | 218 × 36     |
| checkbox (`touch-target`) | 44 × 44   | 44 × 44   | 44 × 44     | 20 × 19      |
| breadcrumb link           | 56 × 44   | 56 × 44   | 56 × 44     | 56 × 19      |
| inline mention (exempt)   | 48 × 23   | 48 × 23   | 48 × 23     | 48 × 23      |

The first run found the touch **tablet** below 44 px for links and checkbox labels, because
they used width-based classes. The floor now also applies to any coarse pointer. The same run
found that a long breadcrumb overflowed rather than truncating once it became a flex box; the text
now truncates inside it. Measured afterwards: clipped with an ellipsis, and no overflow of the
list or the page.

To re-run it: build the web app, write a page that links the built CSS from
`apps/web/.next/static/chunks/*.css` with the controls above, and measure bounding boxes with
Playwright at each width, `hasTouch` and `isMobile` set for the three touch widths. Task `120`
brings Playwright into the repository; this belongs in its viewport suite.
