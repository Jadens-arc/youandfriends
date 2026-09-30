import { handleJson, parsePathId, requireWorkspace } from '@/lib/api/http';
import { libraryContext } from '@/lib/library/context';
import { revokeDevice } from '@/lib/sync/tokens';

/** `DELETE /api/sync/devices/:deviceId` (task `110`) — disconnect a device, at once. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ deviceId: string }> },
): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const deviceId = parsePathId((await params).deviceId);
    await revokeDevice({ ...libraryContext(await requireWorkspace()), correlationId }, deviceId);
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  });
}
