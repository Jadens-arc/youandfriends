# 042 — Song workspace and tabs

**Phase:** Library navigation · **Iteration:** one

## Objective

Build the song workspace: header with artwork and metadata, the Overview/Lyrics/Files/Comments tab structure, the large waveform anchor, and the version selector.

## User value

Where the work actually happens — everything about a song in one place, in context.

## Scope

- Header: cover art, title, artist, project, duration, status, collaborators, favorite, share, overflow actions.
- Tabs: Overview, Lyrics, Files, Comments/Activity, with the tab reflected in the URL so it is linkable and survives reload.
- A large waveform region anchoring the view (the component itself arrives in task `072`).
- Version selector making the current version obvious, with A/B selection (behavior in task `075`).
- File groups: Masters, Stems & Samples, Project Files, Artwork.
- Desktop split layout: song list left, detail right. Mobile: full-screen with tabs.
- Make the project library (task `041`) navigable into this view. Project cards and rows, and the
  song entries in the library's Recent songs, Shared with me, Favorites, and Collaborator activity
  modules, are plain text today, because there was no destination to link to. Link them to the
  project's song list and to `/songs/[songId]`.

## Non-scope

- Waveform rendering (task `072`), playback (phase 7), lyrics editor (phase 8), comments (phase 9).
- Share links (deferred `200`).
- Upload into the song (phase 5).

## Dependencies

`041`, `026`

## Files expected to change

```
apps/web/app/(workspace)/songs/[songId]/**
apps/web/components/song/**
packages/db/src/queries/songs.ts
apps/web/components/song/__tests__/**
```

## Implementation notes

- Tab state belongs in the URL. A collaborator should be able to send a link to the Lyrics tab, and reload should not reset to Overview.
- Version state does **not** belong in the URL by default — A/B switching changes it rapidly and would flood history. Keep it in component state with an explicit 'link to this version' action.
- The four file groups are fixed, but Project Files permits user-created subfolders and tags. There is exactly one Project Files area — no Logic or MPC split, per the confirmed amendment.
- Status must never be conveyed by color alone (`docs/DESIGN.md` §12) — pair every status colour with text or an icon.
- The header is dense; at phone widths it must reflow rather than truncate the title into uselessness.

## Security/privacy considerations

Every song query runs through `assertCan`. A song id from the URL is untrusted input — an unauthorized song returns 404-shaped. The IDOR test for songs (task `023`) covers this route explicitly.

## Acceptance criteria

- [x] The header renders all required metadata and actions. (`components/song/__tests__/song-header.test.tsx`: cover, title, artist, project, duration, status, collaborators, favourite, share, overflow. Favourite shows state and is inert until task `044` wires the toggle; Share is present and disabled with a screen-reader explanation until deferred task `200`.)
- [x] Tabs work and the active tab is reflected in the URL and survives reload. (`song-tabs.test.tsx`: `?tab=` is read on render, written with `router.replace`, other parameters kept, keyboard traversal.)
- [x] The waveform region is present and correctly sized. (A fixed-height region, `h-32 md:h-40`, reserved now so task `072` does not move the layout; it states the version's processing state rather than drawing a fake waveform.)
- [x] The version selector shows the current version unambiguously. (`version-selector.test.tsx`: exactly one "Current" badge in words, radio-group semantics, arrow keys; selection is component state with an explicit "Copy link to this version" action, and `?version=` is honoured on load.)
- [x] File groups render as Masters, Stems & Samples, Project Files, Artwork. (`file-groups.test.tsx`; `lib/songs/__tests__/workspace.test.ts` proves mixes and voice notes are excluded and project-level artwork and Project Files included, against a real database.)
- [x] Desktop uses the split layout; mobile is full-screen. (`SplitLayout`, CSS-switched at `md`; asserted by class in `song-header.test.tsx`. Not measured in a real browser — task `016`/`120` own that.)
- [x] Status is never conveyed by color alone. (Work status and processing state are always a word, plus an icon for processing.)
- [x] An unauthorized song id returns 404-shaped. (`lib/songs/__tests__/workspace.test.ts`: another workspace's song from this workspace, this workspace's song to the other tenant, a song-level deny, a trashed song, a malformed id, and an unknown id all refuse `not_found`; `app/(workspace)/songs/__tests__/page.test.tsx` turns that into `notFound()`.)

### Notes

- Library cards, list rows, and the Recent songs, Shared with me, Favorites, and Collaborator activity rows now link to `/projects/[projectId]` and `/songs/[songId]`.
- A song's mobile "Back" goes to its project (and a project's to its folder, when visible) through `MobileBackTarget`, because `/songs` and `/projects` have no index pages.
- A version's processing error text is returned only to viewers who may edit the song; others see that it failed.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/authz test
pnpm build
```

## Manual QA

1. Open a song, switch tabs, reload, confirm the tab persists.
2. Request another workspace's song id directly; confirm a 404-shaped response.
3. View at phone width and confirm the header reflows legibly.

## Rollback/compatibility

UI plus queries. Central to phases 7–9; reverting breaks them.

## Status

`complete`

## Commit

`564a54c`
