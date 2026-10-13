import { markNotificationsSchema } from '@youandfriends/contracts';

import { handleJson, parseBody, requireWorkspace } from '@/lib/api/http';
import { libraryContext } from '@/lib/library/context';
import { setNotificationsRead } from '@/lib/notifications/service';

/** `POST /api/notifications/read` (task `095`): mark some, or all, read — or some unread. */
export async function POST(request: Request): Promise<Response> {
  return handleJson(request, async () => {
    const body = await parseBody(request, markNotificationsSchema);
    await setNotificationsRead(libraryContext(await requireWorkspace()), body, body.read);
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  });
}
