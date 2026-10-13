'use client';

import { BottomSheetBody, BottomSheetContent, Sheet, SheetTitle } from '@youandfriends/ui';

import type { SongPlayback } from '@/lib/comments/playback';
import { refreshComments, useSongComments } from '@/lib/comments/store';

import { Thread } from '../comments-panel';

/**
 * One comment thread in a bottom sheet (task `103`): what a phone opens when a comment marker
 * under the waveform is tapped, so the conversation is read and answered without scrolling
 * away from the music. Half height to start, full height a drag or a button press away. The
 * thread is the same component as in the Comments tab — the same actions, refused by the
 * server the same way.
 */
export function ThreadSheet({
  songId,
  threadId,
  playback,
  onClose,
}: {
  readonly songId: string;
  /** The thread to show; `null` keeps the sheet closed. */
  readonly threadId: string | null;
  readonly playback: SongPlayback | null;
  readonly onClose: () => void;
}) {
  const state = useSongComments(songId);
  const thread =
    threadId === null || state === 'loading' || state === 'error'
      ? null
      : (state.threads.find((candidate) => candidate.id === threadId) ?? null);
  return (
    <Sheet open={thread !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      {thread === null || state === 'loading' || state === 'error' ? null : (
        <BottomSheetContent snapPoints={['half', 'full']} aria-describedby={undefined}>
          <SheetTitle className="text-heading text-foreground font-serif">Comment</SheetTitle>
          <BottomSheetBody>
            <Thread
              thread={thread}
              songId={songId}
              canComment={state.canComment}
              onChanged={() => refreshComments(songId)}
              playback={playback}
            />
          </BottomSheetBody>
        </BottomSheetContent>
      )}
    </Sheet>
  );
}
