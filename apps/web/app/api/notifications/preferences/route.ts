import { updatePreferencesSchema } from '@youandfriends/contracts';

import { handleJson, json, parseBody, requireWorkspace } from '@/lib/api/http';
import { transactionalDatabase } from '@/lib/database';
import { emailAvailability } from '@/lib/notifications/email';
import { readPreferences, updatePreferences } from '@/lib/notifications/preferences';

/**
 * `/api/notifications/preferences` (task `096`): `GET` the signed-in person's preferences, `PUT`
 * changes to them. Only ever their own.
 */
export async function GET(request: Request): Promise<Response> {
  return handleJson(request, async () => {
    const { userId } = await requireWorkspace();
    return json(
      await readPreferences({ db: transactionalDatabase(), userId }, emailAvailability()),
    );
  });
}

export async function PUT(request: Request): Promise<Response> {
  return handleJson(request, async () => {
    const body = await parseBody(request, updatePreferencesSchema);
    const { userId } = await requireWorkspace();
    return json(
      await updatePreferences({ db: transactionalDatabase(), userId }, body, emailAvailability()),
    );
  });
}
