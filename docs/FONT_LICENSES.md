# Font licenses

**You & Friends** self-hosts every typeface it uses. There is no runtime request to a
third-party font CDN, so a visitor's IP address and browsing pattern never reach a font
provider (`docs/DESIGN.md` §11).

`next/font/google` downloads these at build time and serves them from our own origin. The
name is misleading: it is a build-time fetch and a self-hosted result, not a runtime CDN
link. Verified in task `011` — the rendered HTML contains zero references to
`fonts.googleapis.com` or `fonts.gstatic.com`, and the `woff2` files are served from
`/_next/static/media/`.

## In use

| Role                                          | Family        | License                   | Self-hosted use |
| --------------------------------------------- | ------------- | ------------------------- | --------------- |
| Editorial serif — titles, headings, wordmark  | Newsreader    | SIL Open Font License 1.1 | Permitted       |
| Neutral sans — controls, navigation, metadata | Inter         | SIL Open Font License 1.1 | Permitted       |
| Restrained mono — lyrics, timestamps          | IBM Plex Mono | SIL Open Font License 1.1 | Permitted       |

The SIL Open Font License 1.1 permits embedding, redistribution, and self-hosted web use
without a fee. It requires that the fonts not be sold on their own and that any Reserved Font
Name not be reused on a modified version. We do neither, so no further obligation applies.

## Before adding a family

1. Confirm the license permits self-hosted web use.
2. Confirm it does not require a runtime request to the vendor.
3. Add a row above and a test in `packages/ui/src/tokens.test.ts`, so the documentation
   cannot drift from what is actually loaded.

A family whose license cannot be confirmed does not ship. This is not a formality — a font
with an unclear license is a legal exposure the product does not need.
