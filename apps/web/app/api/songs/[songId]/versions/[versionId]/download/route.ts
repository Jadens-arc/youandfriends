import { handleJson, parsePathId, requireWorkspace } from '@/lib/api/http';
import { mapUploadError } from '@/lib/uploads/http';
import { downloadContextFor } from '@/lib/versions/http';
import { versionDownloadUrl } from '@/lib/versions/service';

/**
 * `GET /api/songs/:songId/versions/:versionId/download` — the untouched original (task `056`).
 *
 * A redirect to a five-minute presigned URL, issued only after `can_download` is checked. The
 * URL appears in the `Location` header and nowhere else; `no-referrer` keeps it out of the
 * `Referer` of anything the download page might load, and `no-store` out of every cache.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ songId: string; versionId: string }> },
): Promise<Response> {
  return handleJson(
    request,
    async (correlationId) => {
      const { songId, versionId } = await params;
      const context = await requireWorkspace();
      const url = await versionDownloadUrl(
        downloadContextFor(context, correlationId),
        parsePathId(songId),
        parsePathId(versionId),
      );
      return new Response(null, {
        status: 302,
        headers: { location: url, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
      });
    },
    mapUploadError,
  );
}
