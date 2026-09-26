import 'server-only';

import { emailConfigFrom, loggerForEnv, parseServerEnv } from '@youandfriends/config';
import { NOTIFICATION_EMAIL_TASK_ID } from '@youandfriends/contracts';
import { triggerClientFrom } from '@youandfriends/jobs/client';

/**
 * Email delivery from the web tier's side (task `096`): whether it can happen at all, and handing
 * immediate email to the worker.
 *
 * Email is available only when every part is configured — Resend, the unsubscribe-link secret,
 * the app's address, and the queue that sends. Anything missing, and the preferences page says
 * email is unavailable; no row is marked for email; nothing pretends.
 */
export type EmailAvailability =
  { readonly available: true } | { readonly available: false; readonly missing: readonly string[] };

export function emailAvailability(): EmailAvailability {
  const env = parseServerEnv();
  const email = emailConfigFrom(env);
  const missing = [
    ...('missing' in email ? email.missing : []),
    ...(triggerClientFrom(env) === null ? ['TRIGGER_SECRET_KEY'] : []),
  ];
  return missing.length === 0 ? { available: true } : { available: false, missing };
}

/**
 * Hand immediate email to the worker. Never throws: a queue that is down leaves the rows
 * `pending`, and the daily sweep sends them — late, but not lost, and never reported as sent.
 */
export async function dispatchEmail(notificationIds: readonly string[]): Promise<void> {
  if (notificationIds.length === 0) return;
  const env = parseServerEnv();
  const client = triggerClientFrom(env);
  if (client === null) return;
  try {
    await client.trigger(
      NOTIFICATION_EMAIL_TASK_ID,
      { notificationIds: [...notificationIds] },
      { idempotencyKey: `notification-email:${[...notificationIds].sort().join(',')}` },
    );
  } catch (error) {
    loggerForEnv(env).warn('notification email not dispatched', {
      count: notificationIds.length,
      error: error instanceof Error ? error.name : 'unknown',
    });
  }
}

/** What a request's notification sink uses to decide on and hand off email. */
export function productionEmail() {
  return { available: emailAvailability().available, dispatch: dispatchEmail };
}
