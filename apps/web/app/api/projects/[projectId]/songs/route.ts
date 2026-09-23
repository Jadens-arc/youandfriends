import { createSongSchema } from '@youandfriends/contracts';

import { handleJson, json, parseBody, parsePathId, requireWorkspace } from '@/lib/api/http';
import { libraryContext } from '@/lib/library/context';
import { createSong } from '@/lib/library/create';

/** `POST /api/projects/:projectId/songs` — start a song in a project (task `046`). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const body = await parseBody(request, createSongSchema);
    const projectId = parsePathId((await params).projectId);
    const context = await requireWorkspace();
    return json(
      await createSong({ ...libraryContext(context), correlationId }, projectId, body),
      201,
    );
  });
}
