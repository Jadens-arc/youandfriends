import { favoriteRequestSchema } from '@youandfriends/contracts';

import { handleJson, parseBody, requireWorkspace } from '@/lib/api/http';
import { libraryContext } from '@/lib/library/context';
import { toggleFavorite } from '@/lib/library/personal';

/** `PUT /api/favorites` — favourite or un-favourite something this person can see (task `044`). */
export async function PUT(request: Request): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const body = await parseBody(request, favoriteRequestSchema);
    const context = await requireWorkspace();
    await toggleFavorite({ ...libraryContext(context), correlationId }, body);
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  });
}
