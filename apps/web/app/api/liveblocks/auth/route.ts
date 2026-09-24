import { Liveblocks } from '@liveblocks/node';
import { parseServerEnv } from '@youandfriends/config';
import { z } from 'zod';

import { handleJson, json, parseBody, requireWorkspace } from '@/lib/api/http';
import { libraryContext } from '@/lib/library/context';
import { displayNameOf, mintRoomToken, roomAccess } from '@/lib/lyrics/collaboration';

const bodySchema = z.object({ room: z.string().min(1).max(200) });

/**
 * `POST /api/liveblocks/auth` — a room token for one lyrics room (task `082`, threat T6).
 *
 * Liveblocks' client calls this with the room it wants; the answer is decided here from the
 * signed-in person's access to that song, and names that room alone. Without
 * `LIVEBLOCKS_SECRET_KEY` it says so with a 503 — the editor carries on single-player.
 */
export async function POST(request: Request): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const secret = parseServerEnv().LIVEBLOCKS_SECRET_KEY;
    if (secret === undefined) {
      return json({ error: { code: 'collaboration_unavailable' } }, 503);
    }
    const { room } = await parseBody(request, bodySchema);
    const workspace = await requireWorkspace();
    const context = { ...libraryContext(workspace), correlationId };
    const access = await roomAccess(context, room);
    const minted = await mintRoomToken(new Liveblocks({ secret }), access, {
      userId: context.userId,
      name: await displayNameOf(context),
    });
    return new Response(minted.body, {
      status: minted.status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  });
}
