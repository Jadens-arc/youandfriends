import { verifyUnsubscribe } from '@youandfriends/authz';
import {
  ALWAYS_IN_APP,
  defaultPreference,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_EVENT_LABELS,
  newUlid,
  updatePreferencesSchema,
  validationFailed,
  fieldErrorsFromZod,
  type EmailMode,
  type NotificationEvent,
} from '@youandfriends/contracts';
import {
  listPreferenceRows,
  savePreferenceRows,
  workspaceMemberships,
  type DirectDatabase,
} from '@youandfriends/db';
import { and, eq } from 'drizzle-orm';

import type { LibraryContext } from '@/lib/library/context';

import { emailConfig } from './email';

/**
 * Notification preferences (task `096`): per person, per workspace, per event, per channel.
 *
 * In-app is the required channel: it can be turned off per event, except for the events that
 * must not be missed. Email can be chosen only when this deployment can send it — otherwise the
 * page says email is unavailable, and a request asking for it is refused rather than stored as a
 * setting that would silently do nothing.
 */

export interface EventPreferenceView {
  readonly event: NotificationEvent;
  readonly label: string;
  readonly inApp: boolean;
  readonly inAppLocked: boolean;
  readonly email: EmailMode;
}

export interface PreferencesView {
  readonly email: { readonly available: boolean };
  readonly categories: readonly {
    readonly id: string;
    readonly label: string;
    readonly events: readonly EventPreferenceView[];
  }[];
}

export async function readPreferences(
  context: LibraryContext,
  options: { readonly emailAvailable?: boolean } = {},
): Promise<PreferencesView> {
  const emailAvailable = options.emailAvailable ?? emailConfig().available;
  const stored = new Map(
    (await listPreferenceRows(context.db, context.workspaceId, context.userId)).map((row) => [
      row.event,
      row,
    ]),
  );
  return {
    email: { available: emailAvailable },
    categories: NOTIFICATION_CATEGORIES.map((category) => ({
      id: category.id,
      label: category.label,
      events: category.events.map((event) => {
        const preference = stored.get(event) ?? defaultPreference(event);
        const locked = ALWAYS_IN_APP.includes(event);
        return {
          event,
          label: NOTIFICATION_EVENT_LABELS[event],
          inApp: locked || preference.inApp,
          inAppLocked: locked,
          email: emailAvailable ? preference.email : 'off',
        };
      }),
    })),
  };
}

export async function updatePreferences(
  context: LibraryContext,
  input: unknown,
  options: { readonly emailAvailable?: boolean } = {},
): Promise<void> {
  const parsed = updatePreferencesSchema.safeParse(input);
  if (!parsed.success) throw validationFailed(fieldErrorsFromZod(parsed.error));
  const emailAvailable = options.emailAvailable ?? emailConfig().available;
  if (!emailAvailable && parsed.data.preferences.some((row) => row.email !== 'off')) {
    throw validationFailed([
      { path: 'email', message: 'Email is not set up for this workspace, so it cannot be chosen.' },
    ]);
  }
  await savePreferenceRows(
    context.db,
    context.workspaceId,
    context.userId,
    parsed.data.preferences.map((row) => ({
      event: row.event,
      // The required events stay on in-app whatever is sent.
      inApp: ALWAYS_IN_APP.includes(row.event) || row.inApp,
      email: row.email,
    })),
    context.newId ?? newUlid,
    (context.now ?? (() => new Date()))(),
  );
}

/**
 * Follow an unsubscribe link: turn email off for the one event it names, for the one person and
 * workspace it names — nothing else. A forged or altered token, or one for someone no longer in
 * the workspace, changes nothing and says only that the link did not work.
 */
export async function unsubscribe(
  db: DirectDatabase,
  token: string,
  secret: string,
  now: Date = new Date(),
): Promise<{ readonly event: NotificationEvent } | null> {
  const scope = verifyUnsubscribe(token, secret);
  if (scope === null) return null;
  const [member] = await db
    .select({ id: workspaceMemberships.id })
    .from(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, scope.workspaceId),
        eq(workspaceMemberships.userId, scope.userId),
      ),
    );
  if (member === undefined) return null;
  const current =
    (await listPreferenceRows(db, scope.workspaceId, scope.userId)).find(
      (row) => row.event === scope.event,
    ) ?? defaultPreference(scope.event);
  await savePreferenceRows(
    db,
    scope.workspaceId,
    scope.userId,
    [{ event: scope.event, inApp: current.inApp, email: 'off' }],
    newUlid,
    now,
  );
  return { event: scope.event };
}
