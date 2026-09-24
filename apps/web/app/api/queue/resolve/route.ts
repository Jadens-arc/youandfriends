import { queueSelectionSchema } from '@youandfriends/contracts';

import { handleJson, json, parseBody, requireWorkspace } from '@/lib/api/http';
import { libraryContext } from '@/lib/library/context';
import { resolveQueue } from '@/lib/player/queue-source';

/**
 * `POST /api/queue/resolve` — the tracks this viewer may play for a song list, a project, a
 * folder, or a restored queue's version ids (task `073`). Anything not permitted is left out.
 */
export async function POST(request: Request): Promise<Response> {
  return handleJson(request, async () => {
    const selection = await parseBody(request, queueSelectionSchema);
    const context = await requireWorkspace();
    const tracks = await resolveQueue(libraryContext(context), selection);
    return json({ tracks }, 200);
  });
}
