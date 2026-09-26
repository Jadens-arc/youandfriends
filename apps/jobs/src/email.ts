import { createAuthorizer, memberSubject, permits, signUnsubscribe } from '@youandfriends/authz';
import type { EmailConfig } from '@youandfriends/config';
import {
  describeNotification,
  notificationPath,
  resolvePreferences,
  type NotificationEvent,
  type UserId,
  type WorkspaceId,
} from '@youandfriends/contracts';
import {
  emailModesOf,
  getProjectHeader,
  getSongHeader,
  invitations,
  mixVersions,
  pendingEmailNotifications,
  preferencesOf,
  recordDigest,
  settleEmail,
  users,
  workspaceMemberships,
  workspaces,
  type DirectDatabase,
  type NotificationRow,
} from '@youandfriends/db';
import { and, eq } from 'drizzle-orm';

/**
 * Notification email (task `096`).
 *
 * - **Checked at send time, not only when written.** Between a notification and its email the
 *   reader may have lost access, the song may be in the trash, or they may have switched the
 *   email off. Each is checked again here, and a notification that fails is `skipped`, never sent.
 * - **Minimal.** An email says *that* something happened, in one sentence — who, what, which
 *   song — and links to it. Never a comment's words, never lyrics: email leaves our boundary and
 *   sits in inboxes indefinitely.
 * - **Every email can be stopped from itself**, with a signed link that can only switch that email
 *   off (`packages/authz/src/unsubscribe.ts`), in the body and as `List-Unsubscribe`.
 * - **Unconfigured is not sent.** With no email configuration nothing is marked sent; rows stay
 *   `pending`, which is the truth.
 */

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly headers: Readonly<Record<string, string>>;
  /** So a retried job cannot send the same email twice. */
  readonly idempotencyKey: string;
}

export type SendEmail = (message: EmailMessage) => Promise<void>;

export interface EmailDeps {
  readonly db: DirectDatabase;
  readonly config: EmailConfig | null;
  readonly send: SendEmail;
  readonly now?: () => Date;
}

/** Resend's HTTP API, called directly: one request per email. */
export function resendSender(config: EmailConfig, fetchImpl: typeof fetch = fetch): SendEmail {
  return async (message) => {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': message.idempotencyKey,
      },
      body: JSON.stringify({
        from: config.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: message.headers,
      }),
    });
    // The status only: Resend's error body can echo the request, addresses included.
    if (!response.ok) throw new Error(`Resend refused the email: HTTP ${response.status}`);
  };
}

interface Deliverable {
  readonly row: NotificationRow;
  readonly summary: string;
  readonly path: string | null;
}

interface Recipient {
  readonly email: string;
  readonly wantsEmail: (event: NotificationEvent) => boolean;
  readonly mode: 'immediate' | 'daily';
}

async function recipientsOf(
  db: DirectDatabase,
  ids: readonly string[],
): Promise<Map<string, Recipient>> {
  const unique = [...new Set(ids)];
  const [people, saved, modes] = await Promise.all([
    Promise.all(
      unique.map(async (id) => {
        const [user] = await db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(eq(users.id, id));
        return user;
      }),
    ),
    preferencesOf(db, unique),
    emailModesOf(db, unique),
  ]);
  const recipients = new Map<string, Recipient>();
  for (const person of people) {
    if (person === undefined) continue;
    const resolved = resolvePreferences(saved.filter((row) => row.userId === person.id));
    recipients.set(person.id, {
      email: person.email,
      wantsEmail: (event) => resolved[event].email,
      mode: modes.get(person.id) ?? 'immediate',
    });
  }
  return recipients;
}

/** The notification as its reader may see it now — or null if they may not. */
async function deliverable(
  db: DirectDatabase,
  row: NotificationRow,
  recipient: Recipient,
  now: Date,
): Promise<Deliverable | null> {
  const event = row.event as NotificationEvent;
  if (!recipient.wantsEmail(event)) return null;
  const authz = createAuthorizer(db);
  const subject = memberSubject(row.recipientId as UserId);
  let title: string;
  switch (row.targetType) {
    case 'song': {
      const song = await getSongHeader(db, row.workspaceId, row.targetId);
      if (song === null) return null;
      const access = await authz.resolveAccess(subject, {
        workspaceId: row.workspaceId as WorkspaceId,
        scopeType: 'song',
        scopeId: row.targetId,
      });
      if (!permits(access, 'view')) return null;
      title = song.title;
      break;
    }
    case 'project': {
      const project = await getProjectHeader(db, row.workspaceId, row.targetId);
      if (project === null) return null;
      const access = await authz.resolveAccess(subject, {
        workspaceId: row.workspaceId as WorkspaceId,
        scopeType: 'project',
        scopeId: row.targetId,
      });
      if (!permits(access, 'view')) return null;
      title = project.name;
      break;
    }
    case 'workspace': {
      const [membership] = await db
        .select({ name: workspaces.name })
        .from(workspaceMemberships)
        .innerJoin(workspaces, eq(workspaces.id, workspaceMemberships.workspaceId))
        .where(
          and(
            eq(workspaceMemberships.workspaceId, row.targetId),
            eq(workspaceMemberships.userId, row.recipientId),
          ),
        );
      if (membership === undefined) return null;
      title = membership.name;
      break;
    }
    case 'invitation': {
      const [invitation] = await db
        .select({
          state: invitations.state,
          expiresAt: invitations.expiresAt,
          email: invitations.email,
          workspace: workspaces.name,
        })
        .from(invitations)
        .innerJoin(workspaces, eq(workspaces.id, invitations.workspaceId))
        .where(eq(invitations.id, row.targetId));
      if (
        invitation === undefined ||
        invitation.state !== 'pending' ||
        invitation.expiresAt <= now ||
        invitation.email !== recipient.email.trim().toLowerCase()
      ) {
        return null;
      }
      title = invitation.workspace;
      break;
    }
  }
  const [actor] =
    row.actorId === null
      ? []
      : await db.select({ name: users.displayName }).from(users).where(eq(users.id, row.actorId));
  const [mix] =
    row.detail.mixVersionId === undefined
      ? []
      : await db
          .select({ number: mixVersions.versionNumber })
          .from(mixVersions)
          .where(
            and(
              eq(mixVersions.id, row.detail.mixVersionId),
              eq(mixVersions.workspaceId, row.workspaceId),
            ),
          );
  return {
    row,
    summary: describeNotification(event, {
      actor: actor?.name ?? 'Someone',
      title,
      ...(mix === undefined ? {} : { versionNumber: mix.number }),
    }),
    path: notificationPath(row),
  };
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function compose(
  config: EmailConfig,
  userId: string,
  to: string,
  subject: string,
  lines: readonly { readonly text: string; readonly url: string | null }[],
  scope: NotificationEvent | 'all',
  idempotencyKey: string,
): EmailMessage {
  const token = signUnsubscribe(config.linkSecret, { userId, scope });
  const unsubscribePage = `${config.appUrl}/unsubscribe?t=${encodeURIComponent(token)}`;
  const oneClick = `${config.appUrl}/api/notifications/unsubscribe?t=${encodeURIComponent(token)}`;
  const settings = `${config.appUrl}/settings/notifications`;
  const stop = scope === 'all' ? 'Stop these emails' : 'Stop emails like this';
  const text = [
    ...lines.flatMap((line) => [line.text, ...(line.url === null ? [] : [line.url]), '']),
    '— You & Friends',
    'Where songs live between sessions.',
    '',
    `${stop}: ${unsubscribePage}`,
    `Choose what you get emailed: ${settings}`,
  ].join('\n');
  const html = [
    '<div style="font-family:sans-serif;line-height:1.5">',
    ...lines.map((line) =>
      line.url === null
        ? `<p>${escapeHtml(line.text)}</p>`
        : `<p><a href="${escapeHtml(line.url)}">${escapeHtml(line.text)}</a></p>`,
    ),
    '<p>— You &amp; Friends<br>Where songs live between sessions.</p>',
    `<p><a href="${escapeHtml(unsubscribePage)}">${stop}</a> · <a href="${escapeHtml(settings)}">Choose what you get emailed</a></p>`,
    '</div>',
  ].join('');
  return {
    to,
    subject,
    text,
    html,
    headers: {
      'List-Unsubscribe': `<${oneClick}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    idempotencyKey,
  };
}

const lineOf = (config: EmailConfig, item: Deliverable) => ({
  text:
    item.row.event === 'invitation.received'
      ? `${item.summary}. Open the link in your invitation to accept it.`
      : item.summary,
  url: item.path === null ? null : `${config.appUrl}${item.path}`,
});

export interface EmailOutcome {
  readonly sent: number;
  readonly skipped: number;
  /** Left pending: email unconfigured, or the reader now takes a digest. */
  readonly waiting: number;
}

/** Immediate email: one message per notification. */
export async function sendNotificationEmails(
  deps: EmailDeps,
  notificationIds: readonly string[],
): Promise<EmailOutcome> {
  const rows = await pendingEmailNotifications(deps.db, { ids: notificationIds });
  if (deps.config === null) return { sent: 0, skipped: 0, waiting: rows.length };
  const config = deps.config;
  const now = (deps.now ?? (() => new Date()))();
  const recipients = await recipientsOf(
    deps.db,
    rows.map((row) => row.recipientId),
  );
  let sent = 0;
  let skipped = 0;
  let waiting = 0;
  for (const row of rows) {
    const recipient = recipients.get(row.recipientId);
    if (recipient?.mode === 'daily') {
      waiting += 1;
      continue;
    }
    const item = recipient === undefined ? null : await deliverable(deps.db, row, recipient, now);
    if (recipient === undefined || item === null) {
      skipped += (await settleEmail(deps.db, [row.id], 'skipped', now)).length;
      continue;
    }
    await deps.send(
      compose(
        config,
        row.recipientId,
        recipient.email,
        item.summary,
        [lineOf(config, item)],
        row.event as NotificationEvent,
        `notification:${row.id}`,
      ),
    );
    sent += (await settleEmail(deps.db, [row.id], 'sent', now)).length;
  }
  return { sent, skipped, waiting };
}

/** At most this many lines in a digest; the rest are one link away. */
export const DIGEST_LINES = 25;
/** Immediate email the queue never delivered is swept up after this long. */
export const STRANDED_AFTER_MS = 15 * 60_000;

/**
 * The daily run: one digest per person who takes one, and any immediate email the queue failed
 * to hand over, sent late rather than lost.
 */
export async function sendDigests(deps: EmailDeps): Promise<EmailOutcome> {
  const now = (deps.now ?? (() => new Date()))();
  const rows = await pendingEmailNotifications(deps.db, {});
  if (deps.config === null) return { sent: 0, skipped: 0, waiting: rows.length };
  const config = deps.config;
  const recipients = await recipientsOf(
    deps.db,
    rows.map((row) => row.recipientId),
  );
  const stranded = rows.filter(
    (row) =>
      recipients.get(row.recipientId)?.mode !== 'daily' &&
      row.createdAt.getTime() < now.getTime() - STRANDED_AFTER_MS,
  );
  const late = await sendNotificationEmails(
    deps,
    stranded.map((row) => row.id),
  );
  let { sent, skipped } = late;

  const byPerson = new Map<string, NotificationRow[]>();
  for (const row of rows) {
    if (recipients.get(row.recipientId)?.mode !== 'daily') continue;
    byPerson.set(row.recipientId, [...(byPerson.get(row.recipientId) ?? []), row]);
  }
  for (const [userId, theirs] of byPerson) {
    const recipient = recipients.get(userId);
    if (recipient === undefined) continue;
    const items: Deliverable[] = [];
    const refused: string[] = [];
    for (const row of theirs) {
      const item = await deliverable(deps.db, row, recipient, now);
      if (item === null) refused.push(row.id);
      else items.push(item);
    }
    skipped += (await settleEmail(deps.db, refused, 'skipped', now)).length;
    if (items.length === 0) continue;
    const shown = items.slice(0, DIGEST_LINES);
    const more = items.length - shown.length;
    const lines = [
      ...shown.map((item) => lineOf(config, item)),
      ...(more > 0
        ? [
            {
              text: `And ${more} more in your notifications.`,
              url: `${config.appUrl}/notifications`,
            },
          ]
        : []),
    ];
    await deps.send(
      compose(
        config,
        userId,
        recipient.email,
        items.length === 1
          ? '1 update on You & Friends'
          : `${items.length} updates on You & Friends`,
        lines,
        'all',
        `digest:${userId}:${now.toISOString().slice(0, 10)}`,
      ),
    );
    sent += (
      await settleEmail(
        deps.db,
        items.map((item) => item.row.id),
        'sent',
        now,
      )
    ).length;
    await recordDigest(deps.db, userId, now);
  }
  return { sent, skipped, waiting: 0 };
}
