import { signPartsSchema } from '@youandfriends/contracts';

import { handleJson, json, parseBody, parsePathId, requireWorkspace } from '@/lib/api/http';
import { mapUploadError, uploadContextFor } from '@/lib/uploads/http';
import { signUploadParts } from '@/lib/uploads/service';

/**
 * `POST /api/uploads/:id/parts` — sign a batch of part URLs (task `058`).
 *
 * The part URLs are the only presigned URLs this surface ever returns, and only the ones asked
 * for. They are bearer credentials: never logged, never cached (`no-store`).
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
      const context = await requireWorkspace();
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
