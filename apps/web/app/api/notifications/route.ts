import { handleJson, json, requireWorkspace } from '@/lib/api/http';
import { libraryContext } from '@/lib/library/context';
import { listNotifications } from '@/lib/notifications/service';

/**
 * `GET /api/notifications` (task `095`): this person's notifications in this workspace, filtered
 * by their access now. `?filter=unread` returns only unread ones.
 */
export async function GET(request: Request): Promise<Response> {
  return handleJson(request, async () => {
    const unreadOnly = new URL(request.url).searchParams.get('filter') === 'unread';
    return json(await listNotifications(libraryContext(await requireWorkspace()), { unreadOnly }));
  });
}
