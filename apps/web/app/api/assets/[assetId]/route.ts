import { parseServerEnv } from '@youandfriends/config';
import { updateAssetSchema } from '@youandfriends/contracts';

import { handleJson, parseBody, parsePathId, requireWorkspace } from '@/lib/api/http';
import { trashAsset, updateAsset } from '@/lib/assets/service';
import { libraryContext } from '@/lib/library/context';

const noContent = () =>
  new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });

/** `PATCH /api/assets/:assetId` — rename, move within Project Files, or re-tag (task `057`). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const body = await parseBody(request, updateAssetSchema);
    const assetId = parsePathId((await params).assetId);
    const context = await requireWorkspace();
    await updateAsset({ ...libraryContext(context), correlationId }, assetId, body);
    return noContent();
  });
}

/** `DELETE /api/assets/:assetId` — to the trash, recoverable (task `057`, via task `025`). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const assetId = parsePathId((await params).assetId);
    const context = await requireWorkspace();
    await trashAsset(
      { ...libraryContext(context), correlationId },
      assetId,
      parseServerEnv().YOUANDFRIENDS_RECOVERY_WINDOW_DAYS,
    );
    return noContent();
  });
}
