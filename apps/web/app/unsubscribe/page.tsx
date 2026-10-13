import type { Metadata, Route } from 'next';
import { redirect } from 'next/navigation';

import { PRODUCT_NAME } from '@youandfriends/config';
import { NOTIFICATION_EVENT_LABELS, notificationEventSchema } from '@youandfriends/contracts';

import { transactionalDatabase } from '@/lib/database';
import { emailConfig } from '@/lib/notifications/email';
import { unsubscribe } from '@/lib/notifications/preferences';

export const metadata: Metadata = { title: `Unsubscribe · ${PRODUCT_NAME}` };

/**
 * Where an email's "Stop these emails" link lands (task `096`). Public: the signed token is the
 * credential. Opening the page changes nothing — link scanners open links — and the button posts
 * the form that does. The page names the kind of email only, nothing about any workspace.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[]; done?: string }>;
}) {
  const query = await searchParams;
  const token = Array.isArray(query.token) ? (query.token[0] ?? '') : (query.token ?? '');
  const event = notificationEventSchema.safeParse(token.split('.').slice(2, -1).join('.'));
  const kind = event.success ? NOTIFICATION_EVENT_LABELS[event.data].toLowerCase() : null;

  async function confirm() {
    'use server';
    const config = emailConfig();
    if (!config.available) return;
    await unsubscribe(transactionalDatabase(), token, config.signingSecret);
    redirect('/unsubscribe?done=1' as Route);
  }

  return (
    <main className="bg-background flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-title text-foreground font-serif">
        {query.done === '1' ? 'You are unsubscribed' : 'Stop these emails?'}
      </h1>
      {query.done === '1' ? (
        <p className="text-body text-muted-foreground max-w-sm font-sans">
          You will not get emails like that one again. Everything still arrives in the app, and you
          can change this in your notification settings.
        </p>
      ) : kind === null ? (
        <p className="text-body text-muted-foreground max-w-sm font-sans">
          This link does not work. You can choose what you hear about in your notification settings.
        </p>
      ) : (
        <form action={confirm} className="flex flex-col items-center gap-3">
          <p className="text-body text-muted-foreground max-w-sm font-sans">
            You will stop getting emails when: {kind}. Nothing else changes.
          </p>
          <button
            type="submit"
            className="bg-primary text-primary-foreground text-body min-h-11 rounded-md px-4 font-sans"
          >
            Unsubscribe
          </button>
        </form>
      )}
    </main>
  );
}
