import { createSnapshotSchema } from '@youandfriends/contracts';

import { handleJson, json, parseBody } from '@/lib/api/http';
import { createSnapshot } from '@/lib/snapshots/service';
import { requireSyncAgent } from '@/lib/sync/agent';
import { versionContextFor } from '@/lib/versions/http';

/**
 * `POST /api/sync/agent/snapshots` (task `110`) — the Mac agent's snapshot manifest, through the
 * same service as a browser folder upload, with the device's token as the subject.
 */
export async function POST(request: Request): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const body = await parseBody(request, createSnapshotSchema);
    const context = await requireSyncAgent(request, correlationId);
    return json(await createSnapshot(versionContextFor(context, correlationId), body), 201);
  });
}
