import { loadTargetAudience, signUnsubscribe, targetName } from '@youandfriends/authz';
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@youandfriends/config';
import {
  notificationEventSchema,
  notificationSentence,
  type WorkspaceId,
} from '@youandfriends/contracts';
import {
  listQueuedEmails,
  settleEmails,
  workspaceMemberships,
  type Database,
  type NotificationLink,
  type QueuedEmailRow,
} from '@youandfriends/db';
import { and, eq } from 'drizzle-orm';

/**
 * Sending notification emails (task `096`).
 *
 * The outbox is read in two modes: **immediate** every few minutes, **digest** once a day. Both
 * go through the same steps, per recipient:
 *
 * 1. **Re-check access now.** Each queued event's target must still be openable by its
 *    recipient (the same resolver as every read); one that is not is `dropped`, unsent, and its
 *    song title never leaves the building.
 * 2. **Say little.** One sentence per event — who, what, which song — and a link. Never comment
 *    text, never lyrics: an email sits in an inbox indefinitely.
 * 3. **Unsubscribe per event.** Every line carries a signed link that turns email off for that
 *    one event and nothing else, and the message carries RFC 8058 one-click headers.
 *
 * A send that fails is retried on the next run, up to {@link MAX_ATTEMPTS}; then it is `failed`.
 * Nothing here pretends: an email is `sent` only when the provider accepted it.
 */

export const MAX_ATTEMPTS = 5;

export interface EmailMessage {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly headers: Readonly<Record<string, string>>;
}

export type SendEmail = (message: EmailMessage) => Promise<{ readonly ok: boolean }>;

export interface EmailDeps {
  readonly db: Database;
  readonly from: string;
  readonly appUrl: string;
  readonly signingSecret: string;
  readonly send: SendEmail;
  readonly now?: () => Date;
}

export interface DeliveryReport {
  readonly sent: number;
  readonly dropped: number;
  readonly retried: number;
  readonly failed: number;
}

/** Resend's HTTP API — the real provider, configured by `RESEND_API_KEY`. */
export function resendSender(apiKey: string): SendEmail {
  return async (message) => {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: message.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: message.headers,
      }),
    });
    return { ok: response.ok };
  };
}

function hrefFor(appUrl: string, row: QueuedEmailRow): string {
  const link: NotificationLink | null = row.link;
  if (row.targetType === 'project') return `${appUrl}/projects/${encodeURIComponent(row.targetId)}`;
  if (row.targetType === 'workspace') return `${appUrl}/notifications`;
  const params = new URLSearchParams();
  const tab = link?.tab ?? (link?.threadId === undefined ? undefined : 'activity');
  if (tab !== undefined && tab !== 'overview') params.set('tab', tab);
  if (link?.versionId !== undefined) params.set('version', link.versionId);
  if (link?.threadId !== undefined) params.set('thread', link.threadId);
  const query = params.toString();
  return `${appUrl}/songs/${encodeURIComponent(row.targetId)}${query === '' ? '' : `?${query}`}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function stillMember(db: Database, workspaceId: string, userId: string) {
  const [row] = await db
    .select({ id: workspaceMemberships.id })
    .from(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, workspaceId),
        eq(workspaceMemberships.userId, userId),
      ),
    );
  return row !== undefined;
}

interface Line {
  readonly sentence: string;
  readonly href: string;
  readonly unsubscribe: string;
}

/** Compose one email from the lines that survived the access check. */
export function composeEmail(
  deps: Pick<EmailDeps, 'from' | 'appUrl'>,
  to: string,
  workspaceName: string,
  mode: 'immediate' | 'digest',
  lines: readonly Line[],
): EmailMessage {
  const first = lines[0];
  const subject =
    mode === 'digest' || lines.length > 1
      ? `${lines.length} update${lines.length === 1 ? '' : 's'} in ${workspaceName}`
      : (first?.sentence ?? `An update in ${workspaceName}`);
  const settings = `${deps.appUrl}/settings/notifications`;
  const text = [
    mode === 'digest' ? `Today in ${workspaceName}:` : `In ${workspaceName}:`,
    '',
    ...lines.map(
      (line) => `• ${line.sentence}\n  ${line.href}\n  Stop these emails: ${line.unsubscribe}`,
    ),
    '',
    `Choose what you hear about: ${settings}`,
    '',
    `${PRODUCT_NAME} — ${PRODUCT_TAGLINE}`,
  ].join('\n');
  const html = `<!doctype html><html><body style="font-family: Georgia, serif; color: #241c17; background: #f3eee3; padding: 24px;">
<p>${escapeHtml(mode === 'digest' ? `Today in ${workspaceName}:` : `In ${workspaceName}:`)}</p>
<ul>${lines
    .map(
      (line) =>
        `<li style="margin-bottom: 12px;"><a href="${escapeHtml(line.href)}" style="color: #241c17;">${escapeHtml(line.sentence)}</a><br><a href="${escapeHtml(line.unsubscribe)}" style="color: #746a60; font-size: 13px;">Stop these emails</a></li>`,
    )
    .join('')}</ul>
<p style="font-size: 13px; color: #746a60;"><a href="${escapeHtml(settings)}" style="color: #746a60;">Choose what you hear about</a></p>
<p style="font-size: 13px; color: #746a60;">${escapeHtml(PRODUCT_NAME)} — ${escapeHtml(PRODUCT_TAGLINE)}</p>
</body></html>`;
  return {
    from: deps.from,
    to,
    subject,
    text,
    html,
    headers:
      first === undefined
        ? {}
        : {
            'List-Unsubscribe': `<${first.unsubscribe}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
  };
}

/** Send what the outbox holds for one mode. Returns what became of it. */
export async function deliverQueuedEmails(
  deps: EmailDeps,
  mode: 'immediate' | 'digest',
): Promise<DeliveryReport> {
  const now = deps.now ?? (() => new Date());
  const rows = await listQueuedEmails(deps.db, mode);
  const groups = new Map<string, QueuedEmailRow[]>();
  for (const row of rows) {
    const key = `${row.workspaceId}:${row.recipientId}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const report = { sent: 0, dropped: 0, retried: 0, failed: 0 };
  const audiences = new Map<string, Set<string>>();

  for (const group of groups.values()) {
    const head = group[0];
    if (head === undefined) continue;
    const workspaceId = head.workspaceId as WorkspaceId;
    const dropped: string[] = [];
    const kept: { row: QueuedEmailRow; line: Line }[] = [];
    if (!(await stillMember(deps.db, workspaceId, head.recipientId))) {
      dropped.push(...group.map((row) => row.id));
    } else {
      for (const row of group) {
        const key = `${row.workspaceId}:${row.targetType}:${row.targetId}`;
        let audience = audiences.get(key);
        if (audience === undefined) {
          audience = new Set(
            await loadTargetAudience(deps.db, workspaceId, row.targetType, row.targetId, now),
          );
          audiences.set(key, audience);
        }
        const event = notificationEventSchema.safeParse(row.event);
        const name = audience.has(row.recipientId)
          ? await targetName(deps.db, workspaceId, row.targetType, row.targetId)
          : null;
        if (name === null || !event.success) {
          dropped.push(row.id);
          continue;
        }
        const token = signUnsubscribe(
          { userId: row.recipientId, workspaceId: row.workspaceId, event: event.data },
          deps.signingSecret,
        );
        kept.push({
          row,
          line: {
            sentence: notificationSentence(row.event, row.actorName ?? 'Someone', name),
            href: hrefFor(deps.appUrl, row),
            unsubscribe: `${deps.appUrl}/unsubscribe?token=${encodeURIComponent(token)}`,
          },
        });
      }
    }
    await settleEmails(deps.db, dropped, 'dropped', now());
    report.dropped += dropped.length;
    if (kept.length === 0) continue;

    const ids = kept.map((entry) => entry.row.id);
    let ok = false;
    try {
      ok = (
        await deps.send(
          composeEmail(
            deps,
            head.recipientEmail,
            head.workspaceName,
            mode,
            kept.map((entry) => entry.line),
          ),
        )
      ).ok;
    } catch {
      ok = false;
    }
    if (ok) {
      await settleEmails(deps.db, ids, 'sent', now());
      report.sent += ids.length;
    } else {
      const exhausted = kept.filter((entry) => entry.row.attempts + 1 >= MAX_ATTEMPTS);
      const retry = kept.filter((entry) => entry.row.attempts + 1 < MAX_ATTEMPTS);
      await settleEmails(
        deps.db,
        exhausted.map((entry) => entry.row.id),
        'failed',
        now(),
      );
      await settleEmails(
        deps.db,
        retry.map((entry) => entry.row.id),
        'retry',
        now(),
      );
      report.failed += exhausted.length;
      report.retried += retry.length;
    }
  }
  return report;
}
