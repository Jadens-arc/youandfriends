import { createAssetSchema } from '@youandfriends/contracts';

import { handleJson, json, parseBody, requireWorkspace } from '@/lib/api/http';
import { createAsset } from '@/lib/assets/service';
import { libraryContext } from '@/lib/library/context';

/** `POST /api/assets` — a file in a song or project, ready to receive its first upload (task `055`). */
export async function POST(request: Request): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const body = await parseBody(request, createAssetSchema);
    const context = await requireWorkspace();
    return json(await createAsset({ ...libraryContext(context), correlationId }, body), 201);
  });
}
