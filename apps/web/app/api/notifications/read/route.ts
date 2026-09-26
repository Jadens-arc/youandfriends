import { markNotificationsReadSchema } from '@youandfriends/contracts';

import { handleJson, json, parseBody, requireWorkspace } from '@/lib/api/http';
import { libraryContext } from '@/lib/library/context';
import { markRead } from '@/lib/notifications/service';

/**
 * `POST /api/notifications/read` (task `095`): `{ ids }` or `{ all: true }`. Only ever this
 * person's own notifications; anyone else's ids match nothing.
 */
export async function POST(request: Request): Promise<Response> {
  return handleJson(request, async () => {
    const body = await parseBody(request, markNotificationsReadSchema);
    const marked = await markRead(libraryContext(await requireWorkspace()), body);
    return json({ marked });
  });
}
