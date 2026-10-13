import { logger, schedules } from '@trigger.dev/sdk';
import { emailConfigFrom, parseServerEnv } from '@youandfriends/config';

import { deliverQueuedEmails, resendSender } from '../email';
import { workerDeps } from '../worker';

/**
 * Notification emails (task `096`): immediate ones every five minutes, the digest daily at
 * 08:00 UTC. With email unconfigured these runs say so and send nothing — and nothing is queued
 * in the first place, because the web app does not queue email it cannot send.
 */
async function run(mode: 'immediate' | 'digest') {
  const config = emailConfigFrom(parseServerEnv());
  if (!config.available) {
    logger.warn('notification email is not configured; nothing sent', {
      missing: config.missing,
    });
    return { skipped: true, missing: config.missing };
  }
  const report = await deliverQueuedEmails(
    {
      db: workerDeps().db,
      from: config.from,
      appUrl: config.appUrl,
      signingSecret: config.signingSecret,
      send: resendSender(config.apiKey),
    },
    mode,
  );
  logger.info('notification emails', { mode, ...report });
  return report;
}

export const immediateNotificationEmails = schedules.task({
  id: 'notification-emails-immediate',
  cron: '*/5 * * * *',
  run: () => run('immediate'),
});

export const digestNotificationEmails = schedules.task({
  id: 'notification-emails-digest',
  cron: '0 8 * * *',
  run: () => run('digest'),
});
