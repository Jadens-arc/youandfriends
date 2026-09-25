import { Liveblocks, WebhookHandler } from '@liveblocks/node';
import { loggerForEnv, parseServerEnv } from '@youandfriends/config';

import { transactionalDatabase } from '@/lib/database';
import { songForRoom } from '@/lib/lyrics/collaboration';
import { mergeRoomState } from '@/lib/lyrics/service';

/**
 * Liveblocks' `ydocUpdated` webhook (task `082`): the room's Yjs document, merged into Postgres.
 *
 * **Public, and authenticated by signature instead**, like the Clerk webhook: the body is
 * verified with `LIVEBLOCKS_WEBHOOK_SECRET` before it is parsed as an event, and the event only
 * names a room — the document itself is fetched from Liveblocks with our secret key, never taken
 * from the request. A second path to persistence, not the first: editors save on their own.
 *
 *   - 503 when unconfigured — retried, so nothing is acknowledged into nothing;
 *   - 400 when the signature fails;
 *   - 500 when fetching or merging fails — retried; merging is idempotent;
 *   - 200 otherwise, including events and rooms this endpoint ignores.
 */
export async function POST(request: Request): Promise<Response> {
  const env = parseServerEnv();
  const log = loggerForEnv(env);
  const signingSecret = env.LIVEBLOCKS_WEBHOOK_SECRET;
  const secret = env.LIVEBLOCKS_SECRET_KEY;
  if (signingSecret === undefined || secret === undefined) {
    log.error('liveblocks webhook received but Liveblocks is not configured');
    return new Response('Liveblocks is not configured.\n', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '300' },
    });
  }

  let event;
  try {
    event = new WebhookHandler(signingSecret).verifyRequest({
      // A plain object: the SDK recognises `Headers` by `instanceof`, which is realm-fragile.
      headers: Object.fromEntries(request.headers),
      rawBody: await request.text(),
    });
  } catch (error) {
    log.warn('liveblocks webhook signature rejected', { error });
    return new Response(null, { status: 400 });
  }
  if (event.type !== 'ydocUpdated') return new Response(null, { status: 200 });
  const songId = songForRoom(event.data.roomId);
  if (songId === null) return new Response(null, { status: 200 });

  try {
    const update = await new Liveblocks({ secret }).getYjsDocumentAsBinaryUpdate(event.data.roomId);
    const outcome = await mergeRoomState(transactionalDatabase(), songId, new Uint8Array(update));
    log.info('liveblocks room merged', { songId, outcome });
    return new Response(null, { status: 200 });
  } catch (error) {
    log.error('liveblocks room merge failed', { songId, error });
    return new Response(null, { status: 500 });
  }
}
