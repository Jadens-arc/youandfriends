import { createProjectSchema } from '@youandfriends/contracts';

import { handleJson, json, parseBody, requireWorkspace } from '@/lib/api/http';
import { libraryContext } from '@/lib/library/context';
import { createProject } from '@/lib/library/create';

/** `POST /api/projects` — start a project (task `046`). */
export async function POST(request: Request): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const body = await parseBody(request, createProjectSchema);
    const context = await requireWorkspace();
    return json(await createProject({ ...libraryContext(context), correlationId }, body), 201);
  });
}
