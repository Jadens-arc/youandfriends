import { fieldErrorsFromZod, validationFailed } from '@youandfriends/contracts';
import { z } from 'zod';

import { handleJson, json, requireWorkspace } from '@/lib/api/http';
import { libraryContext } from '@/lib/library/context';
import { SEARCH_MAX_LENGTH } from '@/lib/search/query';
import { search } from '@/lib/search/service';

const querySchema = z.object({
  q: z
    .string()
    .max(SEARCH_MAX_LENGTH * 2)
    .default(''),
});

/**
 * `GET /api/search?q=…` — the command palette's search (task `045`), or, with no query, what
 * this person opened lately. Results are only ever among what they may open.
 */
export async function GET(request: Request): Promise<Response> {
  return handleJson(request, async (correlationId) => {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({ q: url.searchParams.get('q') ?? undefined });
    if (!parsed.success) throw validationFailed(fieldErrorsFromZod(parsed.error));
    const context = await requireWorkspace();
    return json(await search({ ...libraryContext(context), correlationId }, parsed.data.q));
  });
}
