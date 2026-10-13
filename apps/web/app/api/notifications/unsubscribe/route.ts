import { transactionalDatabase } from '@/lib/database';
import { emailConfig } from '@/lib/notifications/email';
import { unsubscribe } from '@/lib/notifications/preferences';

/**
 * `POST /api/notifications/unsubscribe?token=` (task `096`): RFC 8058 one-click unsubscribe, the
 * POST an email client sends from the `List-Unsubscribe` header. Public — the signed token is the
 * credential, and it can only turn email off for one event. A GET does nothing: link scanners
 * fetch links, and fetching must not change a setting.
 */
export async function POST(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const config = emailConfig();
  const done =
    config.available && token !== ''
      ? await unsubscribe(transactionalDatabase(), token, config.signingSecret)
      : null;
  return new Response(null, {
    status: done === null ? 400 : 204,
    headers: { 'cache-control': 'no-store' },
  });
}
