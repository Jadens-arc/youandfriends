import { TriggerClient as SdkClient } from '@trigger.dev/sdk';
import type { TriggerClient } from '@youandfriends/media';

/**
 * The Trigger.dev transport `TriggerDispatcher` needs (ADR 0002), or `null` when the queue is
 * not configured.
 *
 * `null` is an answer, not a fallback: the caller records the job as queued-and-undispatched,
 * which is the truth. It never substitutes inline work or a pretend handle.
 *
 * A scoped client rather than the SDK's global `configure`, so the web tier's key is held by
 * this object and not by process-wide state another import could change.
 */
export function triggerClientFrom(env: {
  readonly TRIGGER_SECRET_KEY?: string | undefined;
  readonly TRIGGER_API_URL?: string | undefined;
}): TriggerClient | null {
  if (env.TRIGGER_SECRET_KEY === undefined || env.TRIGGER_SECRET_KEY === '') return null;
  const sdk = new SdkClient({
    accessToken: env.TRIGGER_SECRET_KEY,
    ...(env.TRIGGER_API_URL === undefined ? {} : { baseURL: env.TRIGGER_API_URL }),
  });
  return {
    async trigger(taskId, payload, { idempotencyKey }) {
      const handle = await sdk.tasks.trigger(taskId, payload, { idempotencyKey });
      return { id: handle.id };
    },
  };
}
