import { createSnapshotSchema } from '@youandfriends/contracts';

import { handleJson, json, parseBody, requireWorkspace } from '@/lib/api/http';
import { versionContextFor } from '@/lib/versions/http';
import { createSnapshot } from '@/lib/snapshots/service';

/**
 * `POST /api/snapshots` — record a folder's manifest and get the asset its ZIP uploads into
 * (task `054`). Every path is judged again server-side before anything is written.
 */
export async function POST(request: Request): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const body = await parseBody(request, createSnapshotSchema);
    const context = await requireWorkspace();
    return json(await createSnapshot(versionContextFor(context, correlationId), body), 201);
  });
}
