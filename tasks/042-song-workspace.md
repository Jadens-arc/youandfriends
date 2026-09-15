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

- [ ] The header renders all required metadata and actions.
- [ ] Tabs work and the active tab is reflected in the URL and survives reload.
- [ ] The waveform region is present and correctly sized.
- [ ] The version selector shows the current version unambiguously.
- [ ] File groups render as Masters, Stems & Samples, Project Files, Artwork.
- [ ] Desktop uses the split layout; mobile is full-screen.
- [ ] Status is never conveyed by color alone.
- [ ] An unauthorized song id returns 404-shaped.

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

`pending`

## Commit

_(not yet)_
