import { handleJson, json, parsePathId, requireWorkspace } from '@/lib/api/http';
import { createVoiceNoteAsset } from '@/lib/comments/voice-notes';
import { libraryContext } from '@/lib/library/context';

/**
 * `POST /api/songs/:songId/voice-notes` — the asset a recording is uploaded into (task `093`),
 * for anyone who may comment on the song. The recording then goes through the standard upload
 * path, and the comment names this asset.
 */
type Params = { params: Promise<{ songId: string }> };

export async function POST(request: Request, { params }: Params): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const songId = parsePathId((await params).songId);
    const context = { ...libraryContext(await requireWorkspace()), correlationId };
    return json(await createVoiceNoteAsset(context, songId), 201);
  });
}
