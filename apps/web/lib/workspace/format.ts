/**
 * Byte counts for people.
 *
 * Binary units labelled the familiar way — 1 GB here is 1024³ bytes — because the configured
 * quota is binary (`107374182400` is exactly 100 × 1024³) and a quota shown as "107.4 GB" reads
 * as a typo. Finder counts in decimal; the difference is a few percent and is noted in the
 * settings copy rather than hidden.
 */
const UNITS = ['bytes', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return bytes === 1 ? '1 byte' : `${bytes} bytes`;

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // One decimal below 10 so small figures still move visibly; whole numbers above, where a
  // decimal is noise.
  const shown = value < 10 ? value.toFixed(1).replace(/\.0$/, '') : Math.round(value).toString();
  return `${shown} ${UNITS[unit]}`;
}

/** Share of the quota used, as a whole percentage, clamped to what a meter can show. */
export function percentOf(used: number, quota: number): number {
  if (quota <= 0) return 100;
  return Math.min(100, Math.max(0, Math.round((used / quota) * 100)));
}
