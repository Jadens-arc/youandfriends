import { completeUploadSchema } from '@youandfriends/contracts';

import { handleJson, json, parseBody, parsePathId } from '@/lib/api/http';
import { requireSyncAgent } from '@/lib/sync/agent';
import { mapUploadError, uploadContextFor } from '@/lib/uploads/http';
import { completeUploadSession } from '@/lib/uploads/service';

/**
 * `POST /api/sync/agent/uploads/:id/complete` (task `110`) — the upload protocol for the Mac agent:
 * the same service as `/api/uploads/:id/complete`, with the device's token as the subject.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleJson(
    request,
    async (correlationId) => {
      const body = await parseBody(request, completeUploadSchema);
      const sessionId = parsePathId((await params).id);
      const context = await requireSyncAgent(request, correlationId);
      const completed = await completeUploadSession(
        uploadContextFor(context, correlationId),
        sessionId,
        body,
      );
      return json(
        {
          created: completed.created,
          sizeBytes: completed.sizeBytes,
          contentType: completed.contentType,
          checksumSha256: completed.checksumSha256,
        },
        completed.created ? 201 : 200,
      );
    },
    mapUploadError,
  );
}
