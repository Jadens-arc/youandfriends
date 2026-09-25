'use client';

import { cn, focusRing } from '@youandfriends/ui';
import { Loader2, Mic, Pause, Play } from 'lucide-react';
import * as React from 'react';

import type { VoiceNoteView } from '@/lib/comments/store';
import { formatClock } from '@/lib/player/format';
import { getPlayer } from '@/lib/player/store';
import { decodeTier } from '@/lib/waveform/decode';

/**
 * A voice note in a comment (task `093`). Voice notes are not transcribed, so what they are is
 * said in words for anyone not listening: a voice note, whose, and how long — before any play.
 * Playback is a plain element of its own with a compact waveform, and pauses the song while it
 * speaks. The stream URL is fetched on the first press, after authorization, and never stored.
 */

const BARS = 48;

function voiceUrl(songId: string, assetId: string, what: 'stream' | 'waveform') {
  return `/api/songs/${encodeURIComponent(songId)}/voice-notes/${encodeURIComponent(assetId)}/${what}`;
}

/** Peak heights 0–1 for `BARS` bars, from the voice note's waveform file. */
async function loadBars(songId: string, assetId: string): Promise<number[] | null> {
  const response = await fetch(voiceUrl(songId, assetId, 'waveform'), { cache: 'force-cache' });
  if (!response.ok) return null;
  const tier = await decodeTier(await response.arrayBuffer(), BARS);
  const frames = tier.peaks.length / (2 * tier.channels);
  const perBar = Math.max(1, Math.floor(frames / BARS));
  const bars: number[] = [];
  for (let bar = 0; bar < BARS; bar += 1) {
    let loudest = 0;
    for (let frame = bar * perBar; frame < Math.min(frames, (bar + 1) * perBar); frame += 1) {
      for (let channel = 0; channel < tier.channels; channel += 1) {
        const at = (frame * tier.channels + channel) * 2;
        loudest = Math.max(
          loudest,
          Math.abs(tier.peaks[at] ?? 0),
          Math.abs(tier.peaks[at + 1] ?? 0),
        );
      }
    }
    bars.push(loudest / 127);
  }
  return bars;
}

export function VoiceNotePlayer({
  songId,
  voiceNote,
  author,
}: {
  readonly songId: string;
  readonly voiceNote: VoiceNoteView;
  readonly author: string | null;
}) {
  const [audio, setAudio] = React.useState<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [bars, setBars] = React.useState<number[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const duration = voiceNote.durationMs === null ? null : formatClock(voiceNote.durationMs / 1000);
  const who = author ?? 'someone';
  const label = `Voice note by ${who}${duration === null ? '' : `, ${duration}`}`;

  React.useEffect(() => {
    if (voiceNote.state !== 'ready') return;
    let cancelled = false;
    void loadBars(songId, voiceNote.assetId)
      .then((loaded) => {
        if (!cancelled) setBars(loaded);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [songId, voiceNote.assetId, voiceNote.state]);

  React.useEffect(
    () => () => {
      audio?.pause();
    },
    [audio],
  );

  async function toggle() {
    if (audio !== null && playing) {
      audio.pause();
      return;
    }
    let element = audio;
    if (element === null) {
      const response = await fetch(voiceUrl(songId, voiceNote.assetId, 'stream'), {
        cache: 'no-store',
      });
      if (!response.ok) {
        setError('This voice note can’t be played right now.');
        return;
      }
      const { url } = (await response.json()) as { url: string };
      element = new Audio(url);
      element.addEventListener('play', () => setPlaying(true));
      element.addEventListener('pause', () => setPlaying(false));
      element.addEventListener('ended', () => {
        setPlaying(false);
        setProgress(0);
      });
      element.addEventListener('timeupdate', () => {
        const total = element?.duration ?? 0;
        setProgress(total > 0 ? (element?.currentTime ?? 0) / total : 0);
      });
      setAudio(element);
    }
    // One sound at a time: the song pauses while the voice note speaks.
    getPlayer().pause();
    setError(null);
    await element.play().catch(() => setError('This voice note can’t be played right now.'));
  }

  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-col gap-1 font-sans"
      data-voice-note={voiceNote.state}
    >
      <div className="flex items-center gap-2">
        {voiceNote.state === 'ready' ? (
          <button
            type="button"
            onClick={() => void toggle()}
            aria-label={
              playing ? `Pause the voice note by ${who}` : `Play the voice note by ${who}`
            }
            className={cn(
              'bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-full max-md:size-11',
              focusRing,
            )}
          >
            {playing ? (
              <Pause aria-hidden className="size-4" />
            ) : (
              <Play aria-hidden className="size-4" />
            )}
          </button>
        ) : (
          <span
            className="text-muted-foreground flex size-8 items-center justify-center"
            aria-hidden
          >
            {voiceNote.state === 'processing' ? (
              <Loader2 className="size-4 motion-safe:animate-spin" />
            ) : (
              <Mic className="size-4" />
            )}
          </span>
        )}
        <div
          aria-hidden
          className="flex h-8 flex-1 items-center gap-px"
          data-bars={bars === null ? 0 : bars.length}
        >
          {(bars ?? Array.from({ length: BARS }, () => 0.08)).map((height, index) => (
            <span
              key={index}
              className={cn(
                'w-full rounded-sm',
                index / BARS < progress ? 'bg-foreground' : 'bg-muted-foreground/40',
              )}
              style={{ height: `${Math.max(8, Math.round(height * 100))}%` }}
            />
          ))}
        </div>
        <span className="text-caption text-muted-foreground tabular font-mono">
          {duration ?? '–:––'}
        </span>
      </div>
      <p className="text-caption text-muted-foreground">
        Voice note
        {voiceNote.state === 'processing' ? ' · being prepared for playback' : ''}
        {voiceNote.state === 'failed' ? ' · couldn’t be prepared for playback' : ''}
      </p>
      {error === null ? null : (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
