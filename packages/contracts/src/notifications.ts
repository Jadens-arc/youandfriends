import { z } from 'zod';

import { ulidSchema } from './ids';

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

/** Marking notifications read (task `095`): some by id, or every one at once. */
export const markNotificationsReadSchema = z.union([
  z.object({ ids: z.array(ulidSchema).min(1).max(500) }),
  z.object({ all: z.literal(true) }),
]);
export type MarkNotificationsReadRequest = z.infer<typeof markNotificationsReadSchema>;

/**
 * Preferences (task `096`). In-app is the required channel (`docs/DESIGN.md` §7): some events
 * are always shown there, because missing them costs something real — being addressed, losing or
 * gaining access, an upload that failed. The rest can be switched off one by one; the channel as
 * a whole cannot.
 */
export const ALWAYS_IN_APP: readonly NotificationEvent[] = [
  'comment.mentioned',
  'access.changed',
  'invitation.received',
  'version.processing_failed',
];

export interface ChannelDefaults {
  readonly in_app: boolean;
  readonly email: boolean;
}

/**
 * Conservative on email: what is addressed to you, and what changes your access, on; every
 * comment off. A noisy default is how people end up turning notifications off altogether.
 */
export const NOTIFICATION_DEFAULTS: Readonly<Record<NotificationEvent, ChannelDefaults>> = {
  'version.created': { in_app: true, email: false },
  'version.processed': { in_app: true, email: false },
  'version.processing_failed': { in_app: true, email: true },
  'comment.created': { in_app: true, email: false },
  'voice_note.created': { in_app: true, email: false },
  'comment.mentioned': { in_app: true, email: true },
  'comment.replied': { in_app: true, email: false },
  'lyrics.changed': { in_app: true, email: false },
  'metadata.changed': { in_app: true, email: false },
  'access.changed': { in_app: true, email: true },
  'invitation.received': { in_app: true, email: true },
};

/** How the preferences page groups events, and what each is called there. */
export const NOTIFICATION_CATEGORIES: readonly {
  readonly label: string;
  readonly events: readonly { readonly event: NotificationEvent; readonly label: string }[];
}[] = [
  {
    label: 'Conversation',
    events: [
      { event: 'comment.mentioned', label: 'Someone mentions you' },
      { event: 'comment.replied', label: 'Replies in a thread you’re part of' },
      { event: 'comment.created', label: 'New comments' },
      { event: 'voice_note.created', label: 'New voice notes' },
    ],
  },
  {
    label: 'Uploads and versions',
    events: [
      { event: 'version.created', label: 'New versions and files' },
      { event: 'version.processed', label: 'Your upload is ready to play' },
      { event: 'version.processing_failed', label: 'Your upload couldn’t be processed' },
    ],
  },
  {
    label: 'Lyrics and details',
    events: [
      { event: 'lyrics.changed', label: 'Lyrics change' },
      { event: 'metadata.changed', label: 'Song or project details change' },
    ],
  },
  {
    label: 'Access',
    events: [
      { event: 'access.changed', label: 'Your access changes' },
      { event: 'invitation.received', label: 'You’re invited somewhere' },
    ],
  },
];

export const EMAIL_MODES = ['immediate', 'daily'] as const;
export const emailModeSchema = z.enum(EMAIL_MODES);
export type EmailMode = z.infer<typeof emailModeSchema>;

export const updatePreferencesSchema = z.object({
  preferences: z
    .array(
      z.object({
        event: notificationEventSchema,
        channel: notificationChannelSchema,
        enabled: z.boolean(),
      }),
    )
    .max(NOTIFICATION_EVENTS.length * NOTIFICATION_CHANNELS.length)
    .default([]),
  emailMode: emailModeSchema.optional(),
});
export type UpdatePreferencesRequest = z.input<typeof updatePreferencesSchema>;

/**
 * One notification in words — the same sentence in the list and in an email. Takes the names it
 * needs, never the content: an email says *that* someone commented, not what they wrote.
 */
export function describeNotification(
  event: NotificationEvent,
  facts: { readonly actor: string; readonly title: string; readonly versionNumber?: number },
): string {
  const { actor, title, versionNumber } = facts;
  switch (event) {
    case 'comment.created':
      return `${actor} commented on ${title}`;
    case 'comment.replied':
      return `${actor} replied on ${title}`;
    case 'voice_note.created':
      return `${actor} left a voice note on ${title}`;
    case 'comment.mentioned':
      return `${actor} mentioned you on ${title}`;
    case 'version.created':
      return versionNumber === undefined
        ? `${actor} uploaded a new file to ${title}`
        : `${actor} uploaded version ${versionNumber} of ${title}`;
    case 'version.processed':
      return `Your upload to ${title} is ready to play`;
    case 'version.processing_failed':
      return `Your upload to ${title} couldn’t be processed`;
    case 'lyrics.changed':
      return `${actor} changed the lyrics of ${title}`;
    case 'metadata.changed':
      return `${actor} edited the details of ${title}`;
    case 'access.changed':
      return `${actor} changed your access in ${title}`;
    case 'invitation.received':
      return `${actor} invited you to ${title}`;
  }
}

/** Where a notification lands, as an app path. Null for an invitation: the link is the invite. */
export function notificationPath(row: {
  readonly event: string;
  readonly targetType: 'song' | 'project' | 'workspace' | 'invitation';
  readonly targetId: string;
  readonly detail: {
    readonly commentId?: string;
    readonly mixVersionId?: string;
    readonly assetVersionId?: string;
  };
}): string | null {
  const id = encodeURIComponent(row.targetId);
  switch (row.targetType) {
    case 'song':
      if (row.detail.commentId !== undefined) {
        return `/songs/${id}?tab=activity#comment-${row.detail.commentId}`;
      }
      if (row.event === 'lyrics.changed') return `/songs/${id}?tab=lyrics`;
      if (row.detail.mixVersionId !== undefined) {
        return `/songs/${id}?version=${encodeURIComponent(row.detail.mixVersionId)}`;
      }
      if (row.detail.assetVersionId !== undefined) return `/songs/${id}?tab=files`;
      return `/songs/${id}`;
    case 'project':
      return `/projects/${id}`;
    case 'workspace':
      return '/';
    case 'invitation':
      return null;
  }
}

export type ResolvedPreferences = Readonly<Record<NotificationEvent, ChannelDefaults>>;

/**
 * What a person actually gets: their saved choices over the defaults, with the always-in-app
 * events held on whatever was saved.
 */
export function resolvePreferences(
  saved: readonly { readonly event: string; readonly channel: string; readonly enabled: boolean }[],
): ResolvedPreferences {
  const resolved = Object.fromEntries(
    NOTIFICATION_EVENTS.map((event) => [event, { ...NOTIFICATION_DEFAULTS[event] }]),
  ) as Record<NotificationEvent, { in_app: boolean; email: boolean }>;
  for (const row of saved) {
    const entry = resolved[row.event as NotificationEvent] as
      { in_app: boolean; email: boolean } | undefined;
    if (entry === undefined || (row.channel !== 'in_app' && row.channel !== 'email')) continue;
    entry[row.channel] = row.enabled;
  }
  for (const event of ALWAYS_IN_APP) resolved[event].in_app = true;
  return resolved;
}

/** The Trigger.dev task that sends notification email (task `096`). */
export const NOTIFICATION_EMAIL_TASK_ID = 'notification-email';
