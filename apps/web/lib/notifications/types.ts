import type { NotificationEvent } from '@youandfriends/contracts';
import type { NotificationDetail } from '@youandfriends/db';

/**
 * Something a collaborator may want to hear about — a domain event (tasks `043`, `095`).
 *
 * Feature code says *what happened*; it never decides who hears. The sink (`generate.ts`) works
 * out the recipients from who can see the target, so every event is held to the same rules: never
 * the actor, never someone without access.
 */
export interface NotificationInput {
  readonly event: NotificationEvent;
  readonly targetType: 'song' | 'project' | 'workspace' | 'invitation';
  readonly targetId: string;
  readonly actorId: string;
  /**
   * Addressed to these people only — a mention's, a reply's participants, the person whose access
   * changed. Still narrowed to people who can see the target. Absent: everyone who can.
   */
  readonly recipientIds?: readonly string[] | undefined;
  /** Not these people — already told about the same thing by a more specific notification. */
  readonly excludeIds?: readonly string[] | undefined;
  /** Where exactly it lands. */
  readonly detail?: NotificationDetail | undefined;
}

export type NotificationSink = (event: NotificationInput) => Promise<void>;
