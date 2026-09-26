import { emailConfigFrom, parseServerEnv } from '@youandfriends/config';

import { transactionalDatabase } from '@/lib/database';
import { unsubscribe } from '@/lib/notifications/preferences';

/**
 * `POST /api/notifications/unsubscribe?t=…` (task `096`) — public: the signed token is the
 * credential. Serves both the one-click `List-Unsubscribe-Post` a mail client sends and the
 * confirm button on `/unsubscribe`. There is no `GET`: a mail scanner following links must not
 * unsubscribe anyone.
 */
export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get('t') ?? '';
  const email = emailConfigFrom(parseServerEnv());
  const done =
    'config' in email && token !== ''
      ? await unsubscribe(transactionalDatabase(), email.config.linkSecret, token)
      : null;
  const fromForm = (request.headers.get('accept') ?? '').includes('text/html');
  if (fromForm) {
    const next = new URL(done === null ? '/unsubscribe?invalid=1' : '/unsubscribe?done=1', url);
    return Response.redirect(next, 303);
  }
  return new Response(done === null ? null : JSON.stringify({ unsubscribed: done.scope }), {
    // The same answer for forged and malformed: nothing to learn by probing.
    status: done === null ? 400 : 200,
    headers: { 'cache-control': 'no-store', 'content-type': 'application/json' },
  });
}
