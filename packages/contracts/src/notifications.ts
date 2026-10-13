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
  // Task `064`: the media job finished a version, or gave up on it. The uploader is waiting on
  // the first; the second is a recoverable error they should hear about (`docs/DESIGN.md` §9).
  'version.processed',
  'version.processing_failed',
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

/** Mark notifications read or unread (task `095`): the ones named, or every one, read. */
export const markNotificationsSchema = z
  .object({
    ids: z.array(z.string().max(26)).max(200).optional(),
    all: z.literal(true).optional(),
    read: z.boolean(),
  })
  .refine((value) => value.all === true || (value.ids !== undefined && value.ids.length > 0), {
    message: 'Name the notifications, or ask for all of them.',
    path: ['ids'],
  });
export type MarkNotificationsRequest = z.infer<typeof markNotificationsSchema>;
