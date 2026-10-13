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

/** How a person hears by email (task `096`): not at all, at once, or in a daily digest. */
export const EMAIL_MODES = ['off', 'immediate', 'digest'] as const;
export const emailModeSchema = z.enum(EMAIL_MODES);
export type EmailMode = z.infer<typeof emailModeSchema>;

/**
 * The events a person can set preferences for, grouped as the settings page shows them. The
 * media worker's own results and invitations are included; every event is somewhere.
 */
export const NOTIFICATION_CATEGORIES = [
  {
    id: 'conversation',
    label: 'Conversation',
    events: ['comment.mentioned', 'comment.replied', 'comment.created', 'voice_note.created'],
  },
  {
    id: 'music',
    label: 'Uploads and versions',
    events: ['version.created', 'version.processed', 'version.processing_failed'],
  },
  { id: 'writing', label: 'Lyrics and details', events: ['lyrics.changed', 'metadata.changed'] },
  { id: 'access', label: 'Access', events: ['access.changed', 'invitation.received'] },
] as const satisfies readonly {
  id: string;
  label: string;
  events: readonly NotificationEvent[];
}[];

export const NOTIFICATION_EVENT_LABELS: Readonly<Record<NotificationEvent, string>> = {
  'comment.mentioned': 'Someone mentions you',
  'comment.replied': 'Replies in a conversation',
  'comment.created': 'New comments',
  'voice_note.created': 'New voice notes',
  'version.created': 'New uploads and versions',
  'version.processed': 'Your upload is ready to play',
  'version.processing_failed': 'Your upload could not be processed',
  'lyrics.changed': 'Lyrics are edited',
  'metadata.changed': 'Song or project details change',
  'access.changed': 'Your access changes',
  'invitation.received': 'Invitations',
};

/**
 * Events whose in-app notification cannot be turned off: in-app is the required channel
 * (`docs/DESIGN.md` §7), and these are the ones a person must not miss.
 */
export const ALWAYS_IN_APP: readonly NotificationEvent[] = [
  'comment.mentioned',
  'access.changed',
  'invitation.received',
  'version.processing_failed',
];

export interface NotificationPreference {
  readonly inApp: boolean;
  readonly email: EmailMode;
}

/**
 * Conservative defaults (task `096`): everything in-app, where grouping keeps it quiet; by email
 * only what is addressed to you or needs you. Noisy defaults get every notification turned off.
 */
export function defaultPreference(event: NotificationEvent): NotificationPreference {
  const email: EmailMode = ALWAYS_IN_APP.includes(event) ? 'immediate' : 'off';
  return { inApp: true, email };
}

export const updatePreferencesSchema = z.object({
  preferences: z
    .array(
      z.object({
        event: notificationEventSchema,
        inApp: z.boolean(),
        email: emailModeSchema,
      }),
    )
    .min(1)
    .max(NOTIFICATION_EVENTS.length),
});
export type UpdatePreferencesRequest = z.infer<typeof updatePreferencesSchema>;

/**
 * What a notification says, in one sentence — the same words in the center and in an email.
 * `target` is the song or project's name, or "this workspace".
 */
export function notificationSentence(
  event: string,
  actor: string,
  target: string,
  count = 1,
): string {
  const many = count > 1;
  switch (event) {
    case 'comment.created':
    case 'comment.replied':
    case 'voice_note.created':
      return many ? `${count} new comments on ${target}` : `${actor} commented on ${target}`;
    case 'comment.mentioned':
      return many
        ? `You were mentioned ${count} times on ${target}`
        : `${actor} mentioned you on ${target}`;
    case 'version.created':
      return many
        ? `${count} new uploads on ${target}`
        : `${actor} uploaded a new version of ${target}`;
    case 'version.processed':
      return `Your upload to ${target} is ready to play`;
    case 'version.processing_failed':
      return `Your upload to ${target} could not be processed`;
    case 'lyrics.changed':
      return `${actor} edited the lyrics of ${target}`;
    case 'metadata.changed':
      return `${actor} changed the details of ${target}`;
    case 'access.changed':
      return target === 'this workspace'
        ? `${actor} changed your access to this workspace`
        : `${actor} changed who can open ${target}`;
    case 'invitation.received':
      return `${actor} invited you to ${target}`;
    default:
      return `Something changed on ${target}`;
  }
}
