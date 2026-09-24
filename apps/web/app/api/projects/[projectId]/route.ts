import { updateProjectSchema } from '@youandfriends/contracts';

import { handleJson, parseBody, parsePathId, requireWorkspace } from '@/lib/api/http';
import { libraryContext } from '@/lib/library/context';
import { updateProject } from '@/lib/library/metadata';

/** `PATCH /api/projects/:projectId` — name, artist, status, cover (task `043`). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const body = await parseBody(request, updateProjectSchema);
    const projectId = parsePathId((await params).projectId);
    const context = await requireWorkspace();
    await updateProject({ ...libraryContext(context), correlationId }, projectId, body);
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  });
}
