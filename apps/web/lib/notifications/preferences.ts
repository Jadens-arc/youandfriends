import { verifyUnsubscribe } from '@youandfriends/authz';
import {
  ALWAYS_IN_APP,
  fieldErrorsFromZod,
  NOTIFICATION_EVENTS,
  newUlid,
  resolvePreferences,
  updatePreferencesSchema,
  validationFailed,
  type EmailMode,
  type NotificationEvent,
  type ResolvedPreferences,
  type UpdatePreferencesRequest,
} from '@youandfriends/contracts';
import {
  emailModesOf,
  preferencesOf,
  savePreferences,
  type DirectDatabase,
} from '@youandfriends/db';

/**
 * A person's notification preferences (task `096`) — their own, across workspaces, read and
 * written only for the person asking; there is no id in any request to point elsewhere.
 */

export interface PreferencesContext {
  readonly db: DirectDatabase;
  readonly userId: string;
  readonly newId?: (() => string) | undefined;
}

export interface PreferencesView {
  readonly preferences: ResolvedPreferences;
  readonly emailMode: EmailMode;
  /** The events that are always shown in-app. */
  readonly alwaysInApp: readonly NotificationEvent[];
  readonly email: { readonly available: boolean };
}

export async function readPreferences(
  context: PreferencesContext,
  email: { readonly available: boolean },
): Promise<PreferencesView> {
  const [saved, modes] = await Promise.all([
    preferencesOf(context.db, [context.userId]),
    emailModesOf(context.db, [context.userId]),
  ]);
  return {
    preferences: resolvePreferences(saved),
    emailMode: modes.get(context.userId) ?? 'immediate',
    alwaysInApp: ALWAYS_IN_APP,
    email: { available: email.available },
  };
}

export async function updatePreferences(
  context: PreferencesContext,
  input: UpdatePreferencesRequest,
  email: { readonly available: boolean },
): Promise<PreferencesView> {
  const parsed = updatePreferencesSchema.safeParse(input);
  if (!parsed.success) throw validationFailed(fieldErrorsFromZod(parsed.error));
  const { preferences, emailMode } = parsed.data;
  // In-app is the required channel: the always-on events cannot be switched off there.
  const locked = preferences.findIndex(
    (change) =>
      change.channel === 'in_app' && !change.enabled && ALWAYS_IN_APP.includes(change.event),
  );
  if (locked !== -1) {
    throw validationFailed([
      { path: `preferences.${locked}.enabled`, message: 'This is always shown in the product.' },
    ]);
  }
  // No saving a choice that could not be honoured: with email unavailable, email is not a setting.
  const emailing = preferences.findIndex((change) => change.channel === 'email' && change.enabled);
  if (!email.available && (emailing !== -1 || emailMode !== undefined)) {
    throw validationFailed([
      {
        path: emailing === -1 ? 'emailMode' : `preferences.${emailing}.enabled`,
        message: 'Email isn’t available yet.',
      },
    ]);
  }
  await savePreferences(
    context.db,
    context.userId,
    preferences,
    emailMode,
    context.newId ?? newUlid,
  );
  return readPreferences(context, email);
}

/**
 * Follow an unsubscribe link: switch email off for the one event it names, or for all email. The
 * token is the whole credential and all it can say; anything else about the request is ignored.
 */
export async function unsubscribe(
  db: DirectDatabase,
  secret: string,
  token: string,
): Promise<{ readonly scope: NotificationEvent | 'all' } | null> {
  const verified = verifyUnsubscribe(secret, token);
  if (verified === null) return null;
  const events = verified.scope === 'all' ? NOTIFICATION_EVENTS : [verified.scope];
  await savePreferences(
    db,
    verified.userId,
    events.map((event) => ({ event, channel: 'email' as const, enabled: false })),
    undefined,
    newUlid,
  );
  return { scope: verified.scope };
}
