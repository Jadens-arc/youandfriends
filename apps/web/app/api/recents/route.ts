import { recentRequestSchema } from '@youandfriends/contracts';

import { handleJson, parseBody, requireWorkspace } from '@/lib/api/http';
import { libraryContext } from '@/lib/library/context';
import { noteRecent } from '@/lib/library/personal';

/**
 * `POST /api/recents` — this person opened or played something (task `044`). Sent as a beacon
 * after the page renders, so viewing a song is not slowed by recording that it was viewed.
 */
export async function POST(request: Request): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const body = await parseBody(request, recentRequestSchema);
    const context = await requireWorkspace();
    await noteRecent({ ...libraryContext(context), correlationId }, body);
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  });
}
