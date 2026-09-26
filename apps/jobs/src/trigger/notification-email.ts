import { logger, schedules, task } from '@trigger.dev/sdk';
import { emailConfigFrom, parseServerEnv } from '@youandfriends/config';
import { NOTIFICATION_EMAIL_TASK_ID } from '@youandfriends/contracts';
import { z } from 'zod';

import { resendSender, sendDigests, sendNotificationEmails, type EmailDeps } from '../email';
import { workerDeps } from '../worker';

/**
 * Notification email tasks (task `096`): immediate sends, handed over by the web tier, and a
 * daily run for digests and anything the queue dropped. Logs carry counts only — never an
 * address, never a subject.
 */
function emailDeps(): EmailDeps {
  const email = emailConfigFrom(parseServerEnv());
  const config = 'config' in email ? email.config : null;
  return {
    db: workerDeps().db,
    config,
    send: config === null ? async () => {} : resendSender(config),
  };
}

const payloadSchema = z.object({ notificationIds: z.array(z.string()).min(1).max(500) });

export const notificationEmail = task({
  id: NOTIFICATION_EMAIL_TASK_ID,
  retry: { maxAttempts: 5, factor: 2, minTimeoutInMs: 10_000, maxTimeoutInMs: 10 * 60_000 },
  run: async (payload: unknown) => {
    const { notificationIds } = payloadSchema.parse(payload);
    const outcome = await sendNotificationEmails(emailDeps(), notificationIds);
    logger.info('notification email', { ...outcome });
    return outcome;
  },
});

export const notificationDigest = schedules.task({
  id: 'notification-digest',
  // Once a day, early morning UTC.
  cron: '7 6 * * *',
  run: async () => {
    const outcome = await sendDigests(emailDeps());
    logger.info('notification digest', { ...outcome });
    return outcome;
  },
});
