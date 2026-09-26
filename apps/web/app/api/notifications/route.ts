import { handleJson, json, requireWorkspace } from '@/lib/api/http';
import { libraryContext } from '@/lib/library/context';
import { listNotifications } from '@/lib/notifications/service';

/**
 * `GET /api/notifications` (task `095`): this person's notifications in this workspace, grouped,
 * filtered by what they can see right now. `?unread=1` for unread only.
 */
export async function GET(request: Request): Promise<Response> {
  return handleJson(request, async () => {
    const unreadOnly = new URL(request.url).searchParams.get('unread') === '1';
    return json(await listNotifications(libraryContext(await requireWorkspace()), { unreadOnly }));
  });
}
