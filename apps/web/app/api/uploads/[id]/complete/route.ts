import { completeUploadSchema } from '@youandfriends/contracts';

import { handleJson, json, parseBody, parsePathId, requireWorkspace } from '@/lib/api/http';
import { mapUploadError, uploadContextFor } from '@/lib/uploads/http';
import { completeUploadSession } from '@/lib/uploads/service';

/**
 * `POST /api/uploads/:id/complete` — finalize (task `058`).
 *
 * Idempotent through the service: a replay answers `200` with `created: false` and the same
 * facts, where the first call answered `201`. The storage object's id stays server-side.
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
      const context = await requireWorkspace();
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
