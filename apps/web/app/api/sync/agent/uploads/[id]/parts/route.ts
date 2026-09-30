import { signPartsSchema } from '@youandfriends/contracts';

import { handleJson, json, parseBody, parsePathId } from '@/lib/api/http';
import { requireSyncAgent } from '@/lib/sync/agent';
import { mapUploadError, uploadContextFor } from '@/lib/uploads/http';
import { signUploadParts } from '@/lib/uploads/service';

/**
 * `POST /api/sync/agent/uploads/:id/parts` (task `110`) — the upload protocol for the Mac agent:
 * the same service as `/api/uploads/:id/parts`, with the device's token as the subject.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleJson(
    request,
    async (correlationId) => {
      const body = await parseBody(request, signPartsSchema);
      const sessionId = parsePathId((await params).id);
      const context = await requireSyncAgent(request, correlationId);
      const parts = await signUploadParts(
        uploadContextFor(context, correlationId),
        sessionId,
        body.partNumbers,
      );
      return json({ parts });
    },
    mapUploadError,
  );
}
