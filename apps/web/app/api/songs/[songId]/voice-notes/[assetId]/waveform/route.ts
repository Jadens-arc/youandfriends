import { WAVEFORM_CONTENT_TYPE } from '@youandfriends/contracts';
import { StorageNotConfiguredError } from '@youandfriends/storage';

import { handleJson, json, parsePathId, requireWorkspace } from '@/lib/api/http';
import { voiceNotePeaks } from '@/lib/comments/voice-notes';
import { libraryContext } from '@/lib/library/context';
import { derivativesDriver } from '@/lib/media/derivatives';

/**
 * `GET /api/songs/:songId/voice-notes/:assetId/waveform` — a voice note's peaks (task `093`),
 * read through the app and authorized like its stream; cached by this browser only.
 */
type Params = { params: Promise<{ songId: string; assetId: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  return handleJson(
    request,
    async () => {
      const { songId, assetId } = await params;
      const context = { ...libraryContext(await requireWorkspace()), derivativesDriver };
      const bytes = await voiceNotePeaks(context, parsePathId(songId), parsePathId(assetId));
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          'content-type': WAVEFORM_CONTENT_TYPE,
          'cache-control': 'private, max-age=300',
          'x-content-type-options': 'nosniff',
        },
      });
    },
    (error, correlationId) =>
      error instanceof StorageNotConfiguredError
        ? json(
            {
              code: 'unavailable',
              message: 'Waveforms are not available right now.',
              correlationId,
            },
            503,
          )
        : null,
  );
}
