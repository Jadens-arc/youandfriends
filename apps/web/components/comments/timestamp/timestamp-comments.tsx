'use client';

import { Button } from '@youandfriends/ui';
import { MessageSquarePlus } from 'lucide-react';
import * as React from 'react';

import { CommentMarkers, type TimelineComment } from '@/components/player/waveform/comment-markers';
import { currentMoment, playAtMoment, type SongPlayback } from '@/lib/comments/playback';
import { sendComment, useSongComments } from '@/lib/comments/store';
import { formatClock } from '@/lib/player/format';
import { belongsToFocus } from '@/lib/player/shortcuts';
import { usePlayerState } from '@/lib/player/store';

import { Composer } from '../comments-panel';

/**
 * Commenting on a moment (task `091`): one press — the button, or C anywhere on the page — opens
 * a comment anchored where the playhead is **at that press**. The track keeps playing while the
 * words are typed; the anchor does not move with it. Below the waveform, the song's moment
 * comments as markers.
 */
export function TimestampComments({
  playback,
  durationMs,
}: {
  readonly playback: SongPlayback;
  /** The length of the version drawn above, for placing markers. */
  readonly durationMs: number | null;
}) {
  const { songId } = playback;
  const state = useSongComments(songId);
  const player = usePlayerState();
  const loadedHere = player.track?.songId === songId;
  const canComment = state !== 'loading' && state !== 'error' && state.canComment;
  const [moment, setMoment] = React.useState<{ versionId: string; ms: number } | null>(null);
  const [message, setMessage] = React.useState('');

  const begin = React.useCallback(() => {
    // The moment is taken now, at initiation — not when the comment is sent.
    const now = currentMoment(songId);
    if (now === null) {
      setMessage('Play this song to comment on a moment in it.');
      return;
    }
    setMessage('');
    setMoment(now);
  }, [songId]);

  React.useEffect(() => {
    if (!canComment) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'c' && event.key !== 'C') return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (belongsToFocus(event.target)) return;
      event.preventDefault();
      begin();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [canComment, begin]);

  const timeline: TimelineComment[] =
    state === 'loading' || state === 'error'
      ? []
      : state.threads.flatMap((thread) => {
          if (thread.anchor.kind !== 'timestamp') return [];
          const first = thread.comments[0];
          return [
            {
              threadId: thread.id,
              ms: thread.anchor.ms,
              versionId: thread.anchor.versionId,
              author: first?.author ?? null,
              excerpt:
                first === undefined || first.deleted
                  ? '(deleted)'
                  : first.body === '' && first.voiceNote != null
                    ? '(voice note)'
                    : first.body,
            },
          ];
        });

  const version = playback.versions.find((candidate) => candidate.id === moment?.versionId);
  return (
    <div className="flex flex-col gap-2">
      <CommentMarkers
        comments={timeline}
        durationMs={durationMs}
        onPlay={(comment) => playAtMoment(playback, comment.versionId, comment.ms)}
      />
      {canComment && moment === null ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-keyshortcuts="C"
            className="max-md:min-h-11"
            onClick={begin}
          >
            <MessageSquarePlus aria-hidden />
            Comment at the playhead
          </Button>
          <p className="text-caption text-muted-foreground font-sans" aria-live="polite">
            {message !== '' ? message : loadedHere ? 'Or press C while listening.' : ''}
          </p>
        </div>
      ) : null}
      {moment === null ? null : (
        <Composer
          label={`Comment at ${formatClock(moment.ms / 1000)}${version === undefined ? '' : ` in version ${version.number}`}`}
          submitLabel="Comment"
          onCancel={() => setMoment(null)}
          onSubmit={async (body) => {
            const ok = await sendComment(songId, '', 'POST', {
              anchor: { kind: 'timestamp', versionId: moment.versionId, ms: moment.ms },
              body,
            });
            if (ok) setMoment(null);
            return ok;
          }}
        />
      )}
    </div>
  );
}
