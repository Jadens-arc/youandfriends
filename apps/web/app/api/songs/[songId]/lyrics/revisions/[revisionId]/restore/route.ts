import { handleJson, json, parsePathId, requireWorkspace } from '@/lib/api/http';
import { libraryContext } from '@/lib/library/context';
import { restoreRevision } from '@/lib/lyrics/revisions';

/**
 * `POST /api/songs/:songId/lyrics/revisions/:revisionId/restore` (task `084`). What is there now
 * is kept as a revision first; the answer carries the restore as a Yjs update for a collaborative
 * editor to apply, so everyone in the room sees it.
 */
type Params = { params: Promise<{ songId: string; revisionId: string }> };

export async function POST(request: Request, { params }: Params): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const { songId, revisionId } = await params;
    const context = { ...libraryContext(await requireWorkspace()), correlationId };
    return json(await restoreRevision(context, parsePathId(songId), parsePathId(revisionId)));
  });
}
