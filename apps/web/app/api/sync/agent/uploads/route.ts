import { createUploadSchema } from '@youandfriends/contracts';

import { handleJson, json, parseBody } from '@/lib/api/http';
import { requireSyncAgent } from '@/lib/sync/agent';
import { mapUploadError, uploadContextFor } from '@/lib/uploads/http';
import { createUploadSession } from '@/lib/uploads/service';

/**
 * `POST /api/sync/agent/uploads` (task `110`) — the upload protocol for the Mac agent:
 * the same service as `/api/uploads`, with the device's token as the subject.
 */
export async function POST(request: Request): Promise<Response> {
  return handleJson(
    request,
    async (correlationId) => {
      // Validated before anything touches the database or storage.
      const body = await parseBody(request, createUploadSchema);
      const context = await requireSyncAgent(request, correlationId);
      const session = await createUploadSession(uploadContextFor(context, correlationId), body);
      return json(
        {
          id: session.id,
          partSizeBytes: session.partSizeBytes,
          partCount: session.partCount,
          expiresAt: session.expiresAt,
        },
        201,
      );
    },
    mapUploadError,
  );
}
