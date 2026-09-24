import { handleJson, parsePathId, requireWorkspace } from '@/lib/api/http';
import { mapUploadError, uploadContextFor } from '@/lib/uploads/http';
import { abortUploadSession } from '@/lib/uploads/service';

/** `POST /api/uploads/:id/abort` — cancel, and stop paying for the parts (task `058`). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleJson(
    request,
    async (correlationId) => {
      const sessionId = parsePathId((await params).id);
      const context = await requireWorkspace();
      await abortUploadSession(uploadContextFor(context, correlationId), sessionId);
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
    },
    mapUploadError,
  );
}
