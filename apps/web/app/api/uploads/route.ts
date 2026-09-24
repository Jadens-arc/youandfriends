import { createUploadSchema } from '@youandfriends/contracts';

import { handleJson, json, parseBody, requireWorkspace } from '@/lib/api/http';
import { mapUploadError, uploadContextFor } from '@/lib/uploads/http';
import { createUploadSession } from '@/lib/uploads/service';

/**
 * `POST /api/uploads` — open an upload session (task `058`).
 *
 * The response is the session id, the part size, the part count, and the expiry. Never the
 * object key and never the storage provider's upload id: the client is told how to send its
 * bytes, not where they are going (`docs/THREAT_MODEL.md` T3, T4).
 */
export async function POST(request: Request): Promise<Response> {
  return handleJson(
    request,
    async (correlationId) => {
      // Validated before anything touches the database or storage.
      const body = await parseBody(request, createUploadSchema);
      const context = await requireWorkspace();
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
