import { z } from 'zod';

/**
 * What a person can be notified about (`docs/DESIGN.md` §7).
 *
 * Defined before delivery exists (tasks `095`–`096`) so the code that *causes* each event can name
 * it now: task `043`'s metadata edits are `metadata.changed`, task `056`'s uploads are
 * `version.created`. The in-app center and email delivery read this list; preferences are per
 * event and per channel.
 */
export const NOTIFICATION_EVENTS = [
  'version.created',
  'comment.created',
  'voice_note.created',
  'comment.mentioned',
  'comment.replied',
  'lyrics.changed',
  'metadata.changed',
  'access.changed',
  'invitation.received',
] as const;
export const notificationEventSchema = z.enum(NOTIFICATION_EVENTS);
export type NotificationEvent = z.infer<typeof notificationEventSchema>;

export const NOTIFICATION_CHANNELS = ['in_app', 'email'] as const;
export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;
