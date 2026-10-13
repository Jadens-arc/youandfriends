import type { NotificationEvent } from '@youandfriends/contracts';
import type { NotificationLink } from '@youandfriends/db';

/**
 * Something a collaborator may want to hear about (tasks `043`, `094`, `095`).
 *
 * Feature code raises the domain event through the context's sink and nothing more; who hears
 * about it, how it groups, and what it links to are decided in one place (`./generate.ts`), so
 * coverage does not depend on each feature remembering to write a notification row.
 */
export type NotificationSink = (event: {
  readonly event: NotificationEvent;
  readonly targetType: 'song' | 'project' | 'workspace';
  readonly targetId: string;
  readonly actorId: string;
  /**
   * The people this is addressed to, when it is addressed (a mention, task `094`). Absent, the
   * event is for everyone who can open the target.
   */
  readonly recipientIds?: readonly string[];
  /** A few words of what happened — a comment's opening, a version's number. Plain text. */
  readonly preview?: string | undefined;
  /** Where the notification should land, beyond the target: a thread, a version, a tab. */
  readonly link?: NotificationLink | undefined;
}) => Promise<void>;
