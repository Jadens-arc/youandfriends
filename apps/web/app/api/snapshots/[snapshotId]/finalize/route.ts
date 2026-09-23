import { finalizeSnapshotSchema } from '@youandfriends/contracts';

import { handleJson, json, parseBody, parsePathId, requireWorkspace } from '@/lib/api/http';
import { finalizeSnapshot } from '@/lib/snapshots/service';
import { versionContextFor } from '@/lib/versions/http';

/** `POST /api/snapshots/:snapshotId/finalize` — seal it with its uploaded ZIP (task `054`). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ snapshotId: string }> },
): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const body = await parseBody(request, finalizeSnapshotSchema);
    const snapshotId = parsePathId((await params).snapshotId);
    const context = await requireWorkspace();
    const result = await finalizeSnapshot(
      versionContextFor(context, correlationId),
      snapshotId,
      body.sessionId,
    );
    return json(result, result.created ? 201 : 200);
  });
}
