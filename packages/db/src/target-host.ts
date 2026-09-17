/**
 * The host a database URL points at.
 *
 * Every command-line tool that writes to a database announces its target before writing
 * (`docs/THREAT_MODEL.md` T10), and one of them refuses on it. That is three callers, so the
 * parser lives here rather than inside whichever one needed it first — `seedTargetHost` was
 * the wrong name the moment `migrate` and `purge` started using it.
 */

/** The lowercased host, or `null` when the string is not a URL whose host can be read. */
export function targetHost(url: string): string | null {
  try {
    // `postgresql://` is not a special scheme to WHATWG URL, but hostname still parses.
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** The host to print, including the honest answer when there is none. */
export function describeTarget(url: string | undefined): string {
  if (url === undefined || url === '') return 'unknown — no database URL is set';
  return targetHost(url) ?? 'unknown — the database URL has no readable host';
}
