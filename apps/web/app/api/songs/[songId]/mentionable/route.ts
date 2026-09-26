import { handleJson, json, parsePathId, requireWorkspace } from '@/lib/api/http';
import { listMentionable } from '@/lib/comments/mentions';
import { libraryContext } from '@/lib/library/context';

/**
 * `GET /api/songs/:songId/mentionable` (task `094`): who this person may mention on this song —
 * the people who can see it, and only for someone who may comment. Filtered here, never in the
 * browser: the unfiltered list is the membership disclosure it exists to prevent.
 */
type Params = { params: Promise<{ songId: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  return handleJson(request, async () => {
    const songId = parsePathId((await params).songId);
    const context = libraryContext(await requireWorkspace());
    // `you`: so the composer does not warn that mentioning yourself reaches no one.
    return json({ people: await listMentionable(context, songId), you: context.userId });
  });
}
