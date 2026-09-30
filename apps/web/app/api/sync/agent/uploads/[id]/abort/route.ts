import { handleJson, parsePathId } from '@/lib/api/http';
import { requireSyncAgent } from '@/lib/sync/agent';
import { mapUploadError, uploadContextFor } from '@/lib/uploads/http';
import { abortUploadSession } from '@/lib/uploads/service';

/**
 * `POST /api/sync/agent/uploads/:id/abort` (task `110`) — the upload protocol for the Mac agent:
 * the same service as `/api/uploads/:id/abort`, with the device's token as the subject.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleJson(
    request,
    async (correlationId) => {
      const sessionId = parsePathId((await params).id);
      const context = await requireSyncAgent(request, correlationId);
      await abortUploadSession(uploadContextFor(context, correlationId), sessionId);
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
    },
    mapUploadError,
  );
}
