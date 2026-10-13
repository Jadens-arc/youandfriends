import { handleJson, json, requireWorkspace } from '@/lib/api/http';
import { libraryContext } from '@/lib/library/context';
import { unreadCount } from '@/lib/notifications/service';

/** `GET /api/notifications/unread-count` (task `095`): the shell's indicator, polled. */
export async function GET(request: Request): Promise<Response> {
  return handleJson(request, async () =>
    json({ unread: await unreadCount(libraryContext(await requireWorkspace())) }),
  );
}
