'use client';

import { Badge, Button, cn, focusRing, transition } from '@youandfriends/ui';
import { Check, Link2 } from 'lucide-react';
import * as React from 'react';

import { formatRelative } from '@/lib/library/format';
import {
  formatBytes,
  formatDuration,
  describeLoudness,
  formatRange,
  formatSampleRate,
  formatTruePeak,
} from '@/lib/songs/format';
import type { SongCapabilities, SongVersion } from '@/lib/songs/workspace';

import { ProcessingBadge } from './status-badge';
import { UploadVersion } from './versions/upload-version';
import { VersionActions } from './versions/version-actions';
import { WaveformRegion } from './waveform-region';

/**
 * What the waveform region says until the waveform itself is drawn (task `072`): the honest
 * state of this version's audio, never a decorative waveform standing in for a real one.
 */
function WaveformStatus({ version }: { readonly version: SongVersion | null }) {
  const text =
    version === null
      ? 'Upload a mix to see its waveform.'
      : version.processingState === 'failed'
        ? 'This version could not be processed, so there is no waveform to show.'
        : version.processingState === 'complete'
          ? `${versionName(version)} · ${formatDuration(version.durationMs)}`
          : 'The waveform will appear once this version has been processed.';
  return <p className="text-caption text-muted-foreground px-4 text-center font-sans">{text}</p>;
}

/**
 * Which version starts selected: a `?version=` link, when it names one of this song's versions;
 * otherwise the current version; otherwise the newest.
 *
 * Selection is component state, not the URL (task `042`'s notes): A/B switching changes it
 * rapidly and a history entry per switch would bury the page the listener came from. Linking to
 * one version is an explicit action — {@link VersionPanel}'s "Copy link".
 */
export function initialVersionId(
  versions: readonly SongVersion[],
  linked: string | null,
): string | null {
  if (linked !== null && versions.some((version) => version.id === linked)) return linked;
  return versions.find((version) => version.isCurrent)?.id ?? versions[0]?.id ?? null;
}

function versionName(version: SongVersion): string {
  return `Version ${version.number}`;
}

/**
 * The version stack as a radio group (`docs/DESIGN.md` §4): the current version says "Current"
 * in words beside a check — never marked by colour alone — and arrow keys move the selection,
 * which is what makes A/B switching (task `075`) a keypress.
 */
export function VersionSelector({
  versions,
  selectedId,
  onSelect,
  now,
}: {
  readonly versions: readonly SongVersion[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly now: Date;
}) {
  const refs = React.useRef(new Map<string, HTMLButtonElement>());

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const delta =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? -1
          : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = versions[(index + delta + versions.length) % versions.length];
    if (next === undefined) return;
    onSelect(next.id);
    refs.current.get(next.id)?.focus();
  }

  return (
    <div role="radiogroup" aria-label="Versions" className="flex flex-col gap-1">
      {versions.map((version, index) => {
        const selected = version.id === selectedId;
        return (
          <button
            key={version.id}
            ref={(node) => {
              if (node) refs.current.set(version.id, node);
              else refs.current.delete(version.id);
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (selectedId === null && index === 0) ? 0 : -1}
            onClick={() => onSelect(version.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'flex min-h-11 w-full items-center gap-3 rounded-md border px-3 py-2 text-left',
              selected
                ? 'border-primary bg-card shadow-paper'
                : 'border-border-subtle hover:bg-border-subtle border-transparent',
              transition,
              focusRing,
            )}
          >
            <span
              aria-hidden
              className={cn(
                'flex size-4 shrink-0 items-center justify-center rounded-full border',
                selected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border-strong',
              )}
            >
              {selected ? <Check className="size-3" /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-body text-foreground flex items-center gap-2 font-sans font-medium">
                {versionName(version)}
                {version.isCurrent ? (
                  <Badge variant="current">
                    <Check aria-hidden className="size-3" />
                    Current
                  </Badge>
                ) : null}
              </span>
              <span className="text-caption text-muted-foreground block truncate font-sans">
                {version.uploaderName ?? 'Someone'} ·{' '}
                <time dateTime={version.uploadedAt.toISOString()}>
                  {formatRelative(version.uploadedAt, now)}
                </time>
                {version.note === null ? null : ` · ${version.note}`}
              </span>
            </span>
            <span className="text-caption text-muted-foreground tabular shrink-0 font-mono">
              {formatDuration(version.durationMs)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Fact({ term, value }: { readonly term: string; readonly value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-caption text-muted-foreground font-sans">{term}</dt>
      <dd className="text-body text-foreground tabular truncate font-sans">{value}</dd>
    </div>
  );
}

/** Everything `docs/DESIGN.md` §4 lists for a version, for the selected one. */
export function VersionDetails({ version }: { readonly version: SongVersion }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-heading text-foreground font-serif">{versionName(version)}</h3>
        <ProcessingBadge state={version.processingState} />
      </div>
      {version.processingState === 'failed' && version.processingError !== null ? (
        <p role="note" className="text-caption text-destructive font-sans">
          {version.processingError}
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
        <Fact term="File" value={version.fileName} />
        <Fact term="Uploaded by" value={version.uploaderName ?? '–'} />
        <Fact
          term="Uploaded"
          value={
            <time dateTime={version.uploadedAt.toISOString()}>
              {version.uploadedAt.toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })}
            </time>
          }
        />
        <Fact term="Duration" value={formatDuration(version.durationMs)} />
        <Fact term="Format" value={version.codec?.toUpperCase() ?? version.contentType} />
        <Fact term="Sample rate" value={formatSampleRate(version.sampleRateHz)} />
        <Fact
          term="Bit depth"
          value={version.bitDepth === null ? '–' : `${version.bitDepth}-bit`}
        />
        <Fact
          term="Loudness"
          value={describeLoudness(version.integratedLufs, version.loudnessUnavailable)}
        />
        <Fact term="True peak" value={formatTruePeak(version.truePeakDb)} />
        <Fact term="Loudness range" value={formatRange(version.loudnessRangeLu)} />
        <Fact term="Size" value={formatBytes(version.sizeBytes)} />
      </dl>
      {version.note === null ? null : (
        <p className="text-body text-foreground font-sans">
          <span className="sr-only">Note: </span>
          {version.note}
        </p>
      )}
    </div>
  );
}

/**
 * The selector, the selected version's details, and the explicit "link to this version" action,
 * holding the selection between them.
 */
export function VersionPanel({
  versions,
  linkedVersionId,
  now,
  songTitle,
  songId,
  capabilities,
}: {
  readonly versions: readonly SongVersion[];
  readonly linkedVersionId: string | null;
  readonly now: Date;
  /** The song's title, for the waveform region's accessible name. */
  readonly songTitle: string;
  readonly songId: string;
  readonly capabilities: SongCapabilities;
}) {
  const [selectedId, setSelectedId] = React.useState(() =>
    initialVersionId(versions, linkedVersionId),
  );
  const [copied, setCopied] = React.useState(false);
  const selected = versions.find((version) => version.id === selectedId) ?? null;

  async function copyLink() {
    if (selected === null) return;
    const url = new URL(window.location.href);
    url.searchParams.set('version', selected.id);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused (an insecure context, a denied permission): put the link in the
      // address bar instead, where it can still be copied by hand.
      window.history.replaceState(null, '', url.toString());
    }
  }

  if (versions.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <WaveformRegion label={`Waveform for ${songTitle}`}>
          <WaveformStatus version={null} />
        </WaveformRegion>
        <p className="text-body text-muted-foreground font-sans italic">
          No versions yet. The first mix you upload becomes the current version.
        </p>
        {capabilities.edit ? <UploadVersion songId={songId} songTitle={songTitle} /> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <WaveformRegion
        label={
          selected === null
            ? `Waveform for ${songTitle}`
            : `Waveform for ${songTitle}, ${versionName(selected)}`
        }
      >
        <WaveformStatus version={selected} />
      </WaveformRegion>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-caption text-muted-foreground font-sans font-medium tracking-wide uppercase">
              Versions
            </h2>
            <Button variant="ghost" size="sm" onClick={copyLink} disabled={selected === null}>
              <Link2 aria-hidden />
              {copied ? 'Link copied' : 'Copy link to this version'}
            </Button>
          </div>
          <VersionSelector
            versions={versions}
            selectedId={selectedId}
            onSelect={setSelectedId}
            now={now}
          />
          {capabilities.edit ? <UploadVersion songId={songId} songTitle={songTitle} /> : null}
          <p aria-live="polite" className="sr-only">
            {copied ? 'Link to this version copied' : ''}
          </p>
        </div>
        {selected === null ? null : (
          <div className="flex flex-col gap-4">
            <VersionDetails version={selected} />
            <VersionActions
              key={selected.id}
              songId={songId}
              version={selected}
              capabilities={capabilities}
            />
          </div>
        )}
      </div>
    </div>
  );
}
