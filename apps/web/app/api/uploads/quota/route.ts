import { parseServerEnv } from '@youandfriends/config';

import { handleJson, json, requireWorkspace } from '@/lib/api/http';
import { readQuota } from '@/lib/assets/service';
import { libraryContext } from '@/lib/library/context';

/** `GET /api/uploads/quota` — room left, so the interface can warn before the limit (task `055`). */
export async function GET(request: Request): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const context = await requireWorkspace();
    const env = parseServerEnv();
    return json({
      quota: await readQuota(
        { ...libraryContext(context), correlationId },
        env.YOUANDFRIENDS_WORKSPACE_QUOTA_BYTES,
      ),
      maxObjectBytes: env.YOUANDFRIENDS_MAX_OBJECT_BYTES,
    });
  });
}
