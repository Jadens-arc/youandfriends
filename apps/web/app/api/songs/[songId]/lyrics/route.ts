import { parseServerEnv } from '@youandfriends/config';
import { saveLyricsSchema } from '@youandfriends/contracts';

import { handleJson, json, parseBody, parsePathId, requireWorkspace } from '@/lib/api/http';
import { libraryContext } from '@/lib/library/context';
import { displayNameOf, presenceColor, roomForSong } from '@/lib/lyrics/collaboration';
import { readLyrics, saveLyrics } from '@/lib/lyrics/service';

/**
 * `/api/songs/:songId/lyrics` (tasks `080`, `082`): `GET` the canonical document, its version,
 * its Yjs state, and — when Liveblocks is configured — the room to join and who to appear as;
 * `PUT` a save. A single-player save against a stale version answers `409` and never overwrites;
 * a collaborative save merges. Both are authorized every time.
 */
type Params = { params: Promise<{ songId: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  return handleJson(request, async () => {
    const songId = parsePathId((await params).songId);
    const library = libraryContext(await requireWorkspace());
    const lyrics = await readLyrics(library, songId);
    const collaboration =
      parseServerEnv().LIVEBLOCKS_SECRET_KEY === undefined
        ? null
        : {
            room: roomForSong(songId),
            self: { name: await displayNameOf(library), color: presenceColor(library.userId) },
          };
    return json({ ...lyrics, collaboration }, 200);
  });
}

export async function PUT(request: Request, { params }: Params): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const body = await parseBody(request, saveLyricsSchema);
    const songId = parsePathId((await params).songId);
    const context = await requireWorkspace();
    const saved = await saveLyrics({ ...libraryContext(context), correlationId }, songId, body);
    return json(saved, 200);
  });
}
