import { formatBytes } from '@/lib/songs/format';
import type { JobState, UploadJob } from '@/lib/upload/store';

/** "2 min left", "about 30 s left" — coarse on purpose; precision here is false precision. */
export function formatEta(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  if (seconds < 10) return 'a few seconds left';
  if (seconds < 60) return `about ${Math.round(seconds / 5) * 5} s left`;
  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60);
    return `about ${minutes} min left`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return `about ${hours} h ${minutes} min left`;
}

export function formatSpeed(bytesPerSecond: number | null): string | null {
  return bytesPerSecond === null ? null : `${formatBytes(Math.round(bytesPerSecond))}/s`;
}

const STATE_LABEL: Readonly<Record<JobState, string>> = {
  queued: 'Waiting',
  preparing: 'Preparing',
  idle: 'Preparing',
  hashing: 'Checking file',
  uploading: 'Uploading',
  paused: 'Paused',
  completing: 'Finishing',
  recording: 'Saving',
  completed: 'Uploaded',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

/** One line of status, in words — progress is never shown by the bar alone. */
export function describeJob(job: UploadJob): string {
  if (job.state === 'failed' && job.error !== null) {
    return job.error.transient ? `Connection trouble — ${job.error.message}` : job.error.message;
  }
  if (job.state === 'uploading') {
    const parts = [
      `${formatBytes(job.uploadedBytes)} of ${formatBytes(job.sizeBytes)}`,
      formatSpeed(job.speed),
      formatEta(job.etaSeconds),
    ].filter((part): part is string => part !== null);
    return parts.join(' · ');
  }
  return STATE_LABEL[job.state];
}
