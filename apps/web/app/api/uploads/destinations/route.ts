import { handleJson, json, requireWorkspace } from '@/lib/api/http';
import { listUploadDestinations } from '@/lib/assets/service';
import { libraryContext } from '@/lib/library/context';

/**
 * `GET /api/uploads/destinations` — where this person may upload (task `055`), filtered
 * server-side. A picker built from this cannot offer a destination the server would refuse.
 */
export async function GET(request: Request): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const context = await requireWorkspace();
    return json({
      destinations: await listUploadDestinations({ ...libraryContext(context), correlationId }),
    });
  });
}
