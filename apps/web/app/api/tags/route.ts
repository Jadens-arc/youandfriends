import { handleJson, json, requireWorkspace } from '@/lib/api/http';
import { listTags } from '@/lib/assets/service';
import { libraryContext } from '@/lib/library/context';

/** `GET /api/tags` — the workspace's tag vocabulary, for suggestions (task `057`). */
export async function GET(request: Request): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const context = await requireWorkspace();
    return json({ tags: await listTags({ ...libraryContext(context), correlationId }) });
  });
}
