import { issueSyncTokenSchema } from '@youandfriends/contracts';

import { handleJson, json, parseBody, requireWorkspace } from '@/lib/api/http';
import { libraryContext } from '@/lib/library/context';
import { issueSyncToken, listDevices } from '@/lib/sync/tokens';

/**
 * `/api/sync/devices` (task `110`) — a signed-in person's Mac devices. `GET` lists them; `POST`
 * pairs a new one and answers with its token, **once**. `no-store`, like every API response here:
 * the token must not sit in any cache.
 */
export async function GET(request: Request): Promise<Response> {
  return handleJson(request, async () =>
    json({ devices: await listDevices(libraryContext(await requireWorkspace())) }),
  );
}

export async function POST(request: Request): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const body = await parseBody(request, issueSyncTokenSchema);
    const context = { ...libraryContext(await requireWorkspace()), correlationId };
    return json(await issueSyncToken(context, body), 201);
  });
}
