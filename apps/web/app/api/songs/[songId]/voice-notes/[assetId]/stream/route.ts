import { StorageNotConfiguredError } from '@youandfriends/storage';

import { handleJson, json, parsePathId, requireWorkspace } from '@/lib/api/http';
import { voiceNoteStream } from '@/lib/comments/voice-notes';
import { libraryContext } from '@/lib/library/context';
import { derivativesDriver } from '@/lib/media/derivatives';

/**
 * `GET /api/songs/:songId/voice-notes/:assetId/stream` — a short-lived URL for a voice note's
 * streaming copy (task `093`), after `view` on the song and only while a live comment carries it.
 * Never logged, never stored: a presigned URL is a bearer credential (T3).
 */
type Params = { params: Promise<{ songId: string; assetId: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  return handleJson(
    request,
    async () => {
      const { songId, assetId } = await params;
      const context = { ...libraryContext(await requireWorkspace()), derivativesDriver };
      return json(await voiceNoteStream(context, parsePathId(songId), parsePathId(assetId)));
    },
    (error, correlationId) =>
      error instanceof StorageNotConfiguredError
        ? json(
            { code: 'unavailable', message: 'Playback is not available right now.', correlationId },
            503,
          )
        : null,
  );
}
