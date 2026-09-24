'use client';

import { Button, cn, focusRing, transition } from '@youandfriends/ui';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Pause,
  Play,
  RotateCcw,
  WifiOff,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import {
  hasUnfinishedWork,
  isActive,
  uploadQueue,
  type UploadJob,
  type UploadQueue,
} from '@/lib/upload/store';

import { describeJob } from './format';

function useJobs(queue: UploadQueue): readonly UploadJob[] {
  return React.useSyncExternalStore(queue.subscribe, queue.getSnapshot, () => []);
}

function percentOf(job: UploadJob): number {
  return job.sizeBytes === 0
    ? 100
    : Math.min(100, Math.round((job.uploadedBytes / job.sizeBytes) * 100));
}

function JobRow({ job, queue }: { readonly job: UploadJob; readonly queue: UploadQueue }) {
  const failed = job.state === 'failed';
  const StatusIcon =
    job.state === 'completed'
      ? CheckCircle2
      : failed
        ? job.error?.transient
          ? WifiOff
          : AlertTriangle
        : null;

  return (
    <li className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex items-start gap-2">
        {StatusIcon === null ? null : (
          <StatusIcon
            aria-hidden
            className={cn(
              'mt-0.5 size-4 shrink-0',
              failed ? 'text-destructive' : 'text-olive-text',
            )}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-body text-foreground truncate font-sans" title={job.fileName}>
            {job.fileName}
          </p>
          <p className="text-caption text-muted-foreground truncate font-sans">
            To {job.destination.label}
          </p>
        </div>
        <div className="flex shrink-0 items-center">
          {job.state === 'uploading' ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Pause ${job.fileName}`}
              onClick={() => queue.pause(job.id)}
            >
              <Pause aria-hidden />
            </Button>
          ) : null}
          {job.state === 'paused' ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Resume ${job.fileName}`}
              onClick={() => queue.resume(job.id)}
            >
              <Play aria-hidden />
            </Button>
          ) : null}
          {failed ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Retry ${job.fileName}`}
              onClick={() => queue.retry(job.id)}
            >
              <RotateCcw aria-hidden />
            </Button>
          ) : null}
          {job.state === 'completed' || job.state === 'cancelled' || failed ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Dismiss ${job.fileName}`}
              onClick={() => queue.dismiss(job.id)}
            >
              <X aria-hidden />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Cancel ${job.fileName}`}
              onClick={() => void queue.cancel(job.id)}
            >
              <X aria-hidden />
            </Button>
          )}
        </div>
      </div>
      {job.state === 'completed' || job.state === 'cancelled' ? null : (
        <div
          role="progressbar"
          aria-label={`Uploading ${job.fileName}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentOf(job)}
          aria-valuetext={describeJob(job)}
          className="bg-border-subtle h-1 w-full overflow-hidden rounded-full"
        >
          <div
            className={cn('h-full', failed ? 'bg-destructive' : 'bg-primary')}
            style={{ width: `${percentOf(job)}%` }}
          />
        </div>
      )}
      <p
        className={cn(
          'text-caption font-sans',
          failed ? 'text-destructive' : 'text-muted-foreground',
        )}
        role={failed ? 'alert' : undefined}
      >
        {describeJob(job)}
      </p>
    </li>
  );
}

/**
 * The upload tray (task `055`): every upload in this tab, persisting across route changes
 * because it lives in the workspace shell beside the player rather than in any page.
 *
 * Failures are split by what can be done about them: a connection problem says so and offers
 * Retry; a refusal ("This workspace does not have room…", "Not found.") says what failed. While
 * anything is moving, closing the tab asks first — browsers do not upload in the background, and
 * pretending otherwise would lose someone's file (`docs/OPERATIONS.md` §9).
 */
export function UploadTray({ queue = uploadQueue() }: { readonly queue?: UploadQueue }) {
  const router = useRouter();
  const jobs = useJobs(queue);
  const [collapsed, setCollapsed] = React.useState(false);
  const active = jobs.filter(isActive).length;
  const unfinished = hasUnfinishedWork(jobs);

  React.useEffect(() => queue.whenCompleted(() => router.refresh()), [queue, router]);

  React.useEffect(() => {
    if (active === 0) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy browsers only show the prompt when this is set.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);

  if (jobs.length === 0) return null;

  const summary =
    active > 0
      ? `Uploading ${active} ${active === 1 ? 'file' : 'files'}`
      : unfinished
        ? 'Uploads need attention'
        : 'Uploads finished';

  return (
    <section
      aria-label="Uploads"
      className={cn(
        'border-border bg-card shadow-paper fixed right-3 z-40 flex w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border',
        // Above the mobile mini-player and bottom navigation, and the desktop player bar.
        'bottom-[calc(8.5rem+env(safe-area-inset-bottom))] md:bottom-24',
      )}
    >
      <header className="border-border-subtle flex items-center gap-2 border-b px-3 py-2">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          className={cn(
            'text-body text-foreground flex min-h-9 flex-1 items-center gap-2 rounded-sm text-left font-sans font-medium',
            transition,
            focusRing,
          )}
        >
          {collapsed ? (
            <ChevronUp aria-hidden className="size-4" />
          ) : (
            <ChevronDown aria-hidden className="size-4" />
          )}
          <span aria-live="polite">{summary}</span>
        </button>
        {active > 0 ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => queue.pauseAll()}>
              Pause all
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void queue.cancelAll()}>
              Cancel all
            </Button>
          </>
        ) : jobs.some((job) => job.state === 'paused' || job.state === 'failed') ? (
          <Button variant="ghost" size="sm" onClick={() => queue.resumeAll()}>
            Resume all
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => queue.clearFinished()}>
            Clear
          </Button>
        )}
      </header>
      {collapsed ? null : (
        <ul className="divide-border-subtle max-h-80 divide-y overflow-auto">
          {jobs.map((job) => (
            <JobRow key={job.id} job={job} queue={queue} />
          ))}
        </ul>
      )}
    </section>
  );
}
