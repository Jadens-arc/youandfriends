import { handleJson, json, parsePathId, requireWorkspace } from '@/lib/api/http';
import { libraryContext } from '@/lib/library/context';
import { readRevision } from '@/lib/lyrics/revisions';

/** `GET /api/songs/:songId/lyrics/revisions/:revisionId` — one earlier draft, whole (task `084`). */
type Params = { params: Promise<{ songId: string; revisionId: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  return handleJson(request, async () => {
    const { songId, revisionId } = await params;
    const context = libraryContext(await requireWorkspace());
    return json(await readRevision(context, parsePathId(songId), parsePathId(revisionId)));
  });
}
