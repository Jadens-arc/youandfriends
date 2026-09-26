import type { Metadata } from 'next';

import { PRODUCT_NAME } from '@youandfriends/config';

export const metadata: Metadata = { title: `Unsubscribe · ${PRODUCT_NAME}` };

/**
 * Where an email's "stop these emails" link lands (task `096`). Public — the link must work
 * signed out — and it changes nothing by being opened: a mail scanner following links must not
 * unsubscribe anyone. The button posts the token; the token is all that is trusted, and it can
 * only switch email off. Says nothing about whose it is.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string | string[]; done?: string; invalid?: string }>;
}) {
  const query = await searchParams;
  const token = Array.isArray(query.t) ? (query.t[0] ?? '') : (query.t ?? '');
  return (
    <main className="bg-background flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-display text-foreground text-2xl tracking-tight">
        {query.done === '1' ? 'You’re unsubscribed' : 'Stop these emails?'}
      </h1>
      {query.done === '1' ? (
        <p className="text-muted-foreground max-w-sm text-sm">
          You won’t get these emails any more. You’ll still see notifications in {PRODUCT_NAME}, and
          you can change what you get emailed in your notification settings.
        </p>
      ) : query.invalid === '1' || token === '' ? (
        <p role="alert" className="text-muted-foreground max-w-sm text-sm">
          This link doesn’t work. You can change what you get emailed in your notification settings.
        </p>
      ) : (
        <form
          method="post"
          action={`/api/notifications/unsubscribe?t=${encodeURIComponent(token)}`}
          className="flex flex-col items-center gap-3"
        >
          <p className="text-muted-foreground max-w-sm text-sm">
            You’ll still see notifications in {PRODUCT_NAME}. Only these emails stop.
          </p>
          <button
            type="submit"
            className="bg-primary text-primary-foreground focus-visible:ring-ring min-h-11 rounded-md px-4 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
          >
            Stop these emails
          </button>
        </form>
      )}
    </main>
  );
}
