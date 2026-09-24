import type { ProcessingState, WorkStatus } from '@youandfriends/contracts';

/**
 * Display formatting for the song workspace (task `042`). Pure, like `lib/library/format.ts`.
 */

/** `3:07`, `1:02:45`. A missing duration is an en dash, never `0:00` — that would be a claim. */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '–';
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

/** A duration as a screen reader should hear it: "3 minutes 7 seconds". */
export function spokenDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return 'unknown length';
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const parts: string[] = [];
  if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
  if (seconds > 0 || minutes === 0)
    parts.push(`${seconds} ${seconds === 1 ? 'second' : 'seconds'}`);
  return parts.join(' ');
}

const UNITS = ['KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return '–';
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${UNITS[unit]}`;
}

/** `48 kHz`, `44.1 kHz`. */
export function formatSampleRate(hz: number | null): string {
  if (hz === null) return '–';
  const khz = hz / 1000;
  return `${Number.isInteger(khz) ? khz.toFixed(0) : khz.toFixed(1)} kHz`;
}

/** `−14.2 LUFS`, with a real minus sign. */
export function formatLoudness(lufs: number | null): string {
  if (lufs === null || !Number.isFinite(lufs)) return '–';
  return `${lufs.toFixed(1).replace('-', '−')} LUFS`;
}

/** Loudness, or why there is none: a measured value, a stated reason, or an en dash if pending. */
export function describeLoudness(lufs: number | null, unavailable: string | null): string {
  if (lufs !== null) return formatLoudness(lufs);
  switch (unavailable) {
    case 'silent':
      return 'Silent';
    case 'too_short':
      return 'Too short to measure';
    case 'unreadable':
      return 'Could not be measured';
    default:
      return '–';
  }
}

export function formatRange(lu: number | null): string {
  if (lu === null || !Number.isFinite(lu)) return '–';
  return `${lu.toFixed(1)} LU`;
}

export function formatTruePeak(db: number | null): string {
  if (db === null || !Number.isFinite(db)) return '–';
  return `${db.toFixed(1).replace('-', '−')} dBTP`;
}

export const WORK_STATUS_LABELS: Readonly<Record<WorkStatus, string>> = {
  idea: 'Idea',
  in_progress: 'In progress',
  mixing: 'Mixing',
  mastering: 'Mastering',
  done: 'Done',
  archived: 'Archived',
};

/** For a status picker, in workflow order. */
export const STATUS_OPTIONS = (Object.keys(WORK_STATUS_LABELS) as WorkStatus[]).map((value) => ({
  value,
  label: WORK_STATUS_LABELS[value],
}));

export const PROCESSING_LABELS: Readonly<Record<ProcessingState, string>> = {
  queued: 'Queued for processing',
  running: 'Processing',
  complete: 'Ready',
  failed: 'Processing failed',
};
