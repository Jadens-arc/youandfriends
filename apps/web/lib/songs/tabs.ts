/**
 * The song workspace's tabs (`docs/DESIGN.md` §4), and the one parser for the `?tab=` value.
 *
 * The tab lives in the URL so a collaborator can send a link straight to the lyrics, and a
 * reload lands where it left off. The value is untrusted input like any other query parameter,
 * so anything that is not one of these falls back to Overview rather than rendering nothing.
 */
export const SONG_TABS = ['overview', 'lyrics', 'files', 'activity'] as const;
export type SongTab = (typeof SONG_TABS)[number];

export const SONG_TAB_LABELS: Readonly<Record<SongTab, string>> = {
  overview: 'Overview',
  lyrics: 'Lyrics',
  files: 'Files',
  activity: 'Comments & activity',
};

export function parseSongTab(value: string | string[] | undefined | null): SongTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return (SONG_TABS as readonly string[]).includes(raw ?? '') ? (raw as SongTab) : 'overview';
}
