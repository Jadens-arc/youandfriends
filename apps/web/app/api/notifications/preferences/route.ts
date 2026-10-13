import { updatePreferencesSchema } from '@youandfriends/contracts';

import { handleJson, json, parseBody, requireWorkspace } from '@/lib/api/http';
import { libraryContext } from '@/lib/library/context';
import { readPreferences, updatePreferences } from '@/lib/notifications/preferences';

/** `/api/notifications/preferences` (task `096`): `GET` this person's choices; `PUT` to change them. */
export async function GET(request: Request): Promise<Response> {
  return handleJson(request, async () =>
    json(await readPreferences(libraryContext(await requireWorkspace()))),
  );
}

export async function PUT(request: Request): Promise<Response> {
  return handleJson(request, async () => {
    const body = await parseBody(request, updatePreferencesSchema);
    const context = libraryContext(await requireWorkspace());
    await updatePreferences(context, body);
    return json(await readPreferences(context));
  });
}
