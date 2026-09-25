'use client';

import { Button, cn } from '@youandfriends/ui';
import { AlertTriangle, Loader2, Mic, Square, Upload } from 'lucide-react';
import * as React from 'react';

import {
  browserRecorderDeps,
  createVoiceRecorder,
  DEFAULT_VOICE_NOTE_LIMIT_MS,
  extensionFor,
  type RecorderDeps,
  type Recording,
  type RecorderState,
  type VoiceRecorder as Recorder,
} from '@/lib/audio/recorder';
import { browserUploader } from '@/lib/upload/browser';
import { formatClock } from '@/lib/player/format';

/**
 * Recording a voice note (task `093`). The microphone prompt is **explained first**: a browser's
 * permission dialog arriving with no context is how a permanent "block" happens. Then a visible
 * countdown to the limit, a stop that releases the microphone at once, and the recording goes up
 * through the standard upload path — the same one music takes — before the comment is posted.
 *
 * Each state says what is happening in words: explaining, asking, recording, preparing,
 * uploading, and what went wrong.
 */

type Phase = RecorderState | 'explaining' | 'uploading' | 'upload_failed';

/** Upload one recording into a new voice-note asset; the asset id, or null on failure. */
export type VoiceNoteUpload = (songId: string, recording: Recording) => Promise<string | null>;

export const uploadVoiceNote: VoiceNoteUpload = async (songId, recording) => {
  const created = await fetch(`/api/songs/${encodeURIComponent(songId)}/voice-notes`, {
    method: 'POST',
  });
  if (!created.ok) return null;
  const { assetId } = (await created.json()) as { assetId: string };
  const file = new File([recording.blob], `Voice note.${extensionFor(recording.mimeType)}`, {
    type: recording.mimeType,
  });
  const uploader = browserUploader({ assetId, file, contentTypeHint: recording.mimeType });
  const result = await uploader.start();
  if (result === null || uploader.session === null) return null;
  // The finished upload becomes the voice note's one version, which starts its processing.
  const recorded = await fetch(`/api/assets/${encodeURIComponent(assetId)}/versions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: uploader.session }),
  });
  return recorded.ok ? assetId : null;
};

const MESSAGES: Partial<Record<Phase, string>> = {
  requesting: 'Waiting for you to allow the microphone…',
  processing: 'Preparing the recording…',
  uploading: 'Uploading the voice note…',
  denied:
    'The microphone was not allowed, so nothing was recorded. You can allow it for this site in your browser’s settings.',
  unsupported: 'This browser can’t record audio here.',
  failed: 'The recording stopped unexpectedly. Nothing was sent.',
  upload_failed: 'The voice note didn’t upload. It hasn’t been posted.',
};

export function VoiceRecorder({
  songId,
  onRecorded,
  deps = null,
  upload = uploadVoiceNote,
}: {
  readonly songId: string;
  /** Post the comment that carries this voice note. */
  readonly onRecorded: (assetId: string) => Promise<boolean>;
  /** The browser's recording APIs — substituted in tests. */
  readonly deps?: Omit<RecorderDeps, 'onChange' | 'onLimit'> | null;
  readonly upload?: VoiceNoteUpload;
}) {
  const [phase, setPhase] = React.useState<Phase>('idle');
  const [, setTick] = React.useState(0);
  const [recorder, setRecorder] = React.useState<Recorder | null>(null);
  const [pending, setPending] = React.useState<Recording | null>(null);

  const send = React.useCallback(
    async (recording: Recording | null) => {
      if (recording === null) {
        setPhase('idle');
        return;
      }
      setPending(recording);
      setPhase('uploading');
      const assetId = await upload(songId, recording);
      if (assetId === null || !(await onRecorded(assetId))) {
        setPhase('upload_failed');
        return;
      }
      setPending(null);
      setPhase('idle');
    },
    [songId, upload, onRecorded],
  );

  // Leaving the page mid-recording must not leave the microphone on.
  React.useEffect(() => () => recorder?.cancel(), [recorder]);

  function begin() {
    const base = deps ?? browserRecorderDeps();
    if (base === null) {
      setPhase('unsupported');
      return;
    }
    const made = createVoiceRecorder({
      ...base,
      onChange: () => {
        setTick((value) => value + 1);
        const state = made.state();
        setPhase((current) => (current === 'uploading' ? current : state));
      },
      onLimit: (recording) => void send(recording),
    });
    setRecorder(made);
    void made.start();
  }

  const current = recorder;
  const message = MESSAGES[phase];

  if (phase === 'idle') {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="max-md:min-h-11"
        onClick={() => setPhase('explaining')}
      >
        <Mic aria-hidden />
        Record a voice note
      </Button>
    );
  }

  return (
    <div
      className="border-border-subtle flex flex-col gap-2 rounded-md border p-3 font-sans"
      data-voice-phase={phase}
    >
      {phase === 'explaining' ? (
        <>
          <p className="text-body text-foreground">
            Your browser will ask to use your microphone. Nothing is recorded until you start, the
            microphone turns off the moment you stop, and a voice note can be up to{' '}
            {formatClock(DEFAULT_VOICE_NOTE_LIMIT_MS / 1000)} long. Only people who can see this
            song can hear it.
          </p>
          <div className="flex gap-2">
            <Button size="sm" className="max-md:min-h-11" onClick={begin}>
              <Mic aria-hidden />
              Start recording
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="max-md:min-h-11"
              onClick={() => setPhase('idle')}
            >
              Cancel
            </Button>
          </div>
        </>
      ) : null}

      {phase === 'recording' && current !== null ? (
        <>
          <p className="text-body text-foreground flex items-center gap-2">
            <span
              aria-hidden
              className="bg-destructive size-2.5 rounded-full motion-safe:animate-pulse"
            />
            Recording
            <span className="tabular font-mono">{formatClock(current.elapsedMs() / 1000)}</span>
            <span className="text-muted-foreground">
              ·{' '}
              <span className="tabular font-mono">{formatClock(current.remainingMs() / 1000)}</span>{' '}
              left
            </span>
          </p>
          {/* Said once when the end is near, not every second. */}
          <p className="sr-only" aria-live="polite">
            {current.remainingMs() <= 30_000 ? '30 seconds of recording left.' : ''}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="max-md:min-h-11"
              onClick={() => void current.stop().then(send)}
            >
              <Square aria-hidden />
              Stop and post
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="max-md:min-h-11"
              onClick={() => current.cancel()}
            >
              Discard
            </Button>
          </div>
        </>
      ) : null}

      {message === undefined ? null : (
        <p
          role={
            phase === 'denied' || phase === 'failed' || phase === 'upload_failed'
              ? 'alert'
              : 'status'
          }
          className={cn(
            'text-caption flex items-center gap-1.5',
            phase === 'denied' ||
              phase === 'failed' ||
              phase === 'upload_failed' ||
              phase === 'unsupported'
              ? 'text-destructive'
              : 'text-muted-foreground',
          )}
        >
          {phase === 'requesting' || phase === 'processing' ? (
            <Loader2 aria-hidden className="size-3.5 motion-safe:animate-spin" />
          ) : phase === 'uploading' ? (
            <Upload aria-hidden className="size-3.5" />
          ) : (
            <AlertTriangle aria-hidden className="size-3.5" />
          )}
          {message}
        </p>
      )}

      {phase === 'denied' ||
      phase === 'failed' ||
      phase === 'unsupported' ||
      phase === 'upload_failed' ? (
        <div className="flex gap-2">
          {phase === 'upload_failed' && pending !== null ? (
            <Button size="sm" className="max-md:min-h-11" onClick={() => void send(pending)}>
              Try the upload again
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            className="max-md:min-h-11"
            onClick={() => {
              recorder?.reset();
              setPending(null);
              setPhase('idle');
            }}
          >
            Close
          </Button>
        </div>
      ) : null}
    </div>
  );
}
