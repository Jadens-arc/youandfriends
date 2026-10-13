import { handleJson, json, parsePathId, requireWorkspace } from '@/lib/api/http';
import { listMentionable } from '@/lib/comments/service';
import { libraryContext } from '@/lib/library/context';

/**
 * `GET /api/songs/:songId/mentionable` (task `094`): who a commenter may @-mention here — the
 * people who can open this song, filtered on the server, never the whole workspace.
 */
type Params = { params: Promise<{ songId: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  return handleJson(request, async () => {
    const songId = parsePathId((await params).songId);
    return json(await listMentionable(libraryContext(await requireWorkspace()), songId));
  });
}
