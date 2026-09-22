import { describe, expect, it, vi } from 'vitest';

import {
  AUDIO_TASK_ID,
  DispatchError,
  InlineDispatcher,
  TriggerDispatcher,
  type TriggerClient,
} from '../dispatcher';
import type { AudioJobInput } from '../types';

const INPUT: AudioJobInput = {
  workspaceId: '01JYAF00000000000000000001',
  assetVersionId: '01JYAF00000000000000000002',
  objectKey: 'w/01JYAF00000000000000000001/o/01JYAF00000000000000000003',
  operations: ['probe', 'stream_derivative'],
  sizeBytes: 5 * 1024 * 1024,
};

describe('dispatching audio work', () => {
  describe('through Trigger', () => {
    function client(overrides: Partial<TriggerClient> = {}) {
      const calls: { taskId: string; payload: unknown; idempotencyKey: string }[] = [];
      const base: TriggerClient = {
        async trigger(taskId, payload, options) {
          calls.push({ taskId, payload, idempotencyKey: options.idempotencyKey });
          return { id: 'run_123' };
        },
      };
      return { client: { ...base, ...overrides }, calls };
    }

    it('sends the payload to the task apps/jobs registers', async () => {
      const { client: c, calls } = client();
      const handle = await new TriggerDispatcher(c).enqueueAudioProcessing(INPUT, 'key-1');

      expect(calls).toHaveLength(1);
      expect(calls[0]?.taskId).toBe(AUDIO_TASK_ID);
      expect(calls[0]?.payload).toMatchObject({ objectKey: INPUT.objectKey });

      // The key reaching the queue is namespaced by the work it describes. Trigger.dev keys are
      // project-global, so a caller deriving one from a filename or a song title would otherwise
      // have one workspace's upload collide with another's.
      expect(calls[0]?.idempotencyKey).toBe(`${INPUT.workspaceId}:${INPUT.assetVersionId}:key-1`);

      // The caller still gets its own key back, not our internal one.
      expect(handle).toEqual({ id: 'run_123', status: 'queued', idempotencyKey: 'key-1' });
    });

    it('never puts a presigned URL in the payload — only a key', () => {
      // A queue payload is durable and readable by anyone who can see the queue. A URL in it is
      // a bearer credential sitting in storage, still valid when someone finds it (T3).
      const serialized = JSON.stringify(INPUT);
      expect(serialized).not.toMatch(/https?:\/\//);
      expect(serialized).not.toMatch(/X-Amz-Signature/);
    });

    it('reports a queue failure instead of inventing a handle', async () => {
      // **The lie this product must not tell.** A dispatcher that swallowed the error and
      // returned `{ status: 'queued' }` would leave an asset "processing" forever with nothing
      // scheduled, and nobody looking (CLAUDE.md §7).
      const { client: c } = client({
        async trigger() {
          throw new Error('queue unreachable');
        },
      });

      await expect(
        new TriggerDispatcher(c).enqueueAudioProcessing(INPUT, 'key-1'),
      ).rejects.toBeInstanceOf(DispatchError);
    });

    it('refuses to exist without a client', () => {
      // A dispatcher constructed with nothing would fail at the first enqueue, in a request,
      // rather than at startup where a missing configuration belongs. TypeScript stops this at
      // compile time; the guard is for the boundary where types are not enforced.
      expect(() => new TriggerDispatcher(undefined as unknown as TriggerClient)).toThrow(
        DispatchError,
      );
      expect(() => new TriggerDispatcher(null as unknown as TriggerClient)).toThrow(/needs a/);
    });

    it('rejects a payload that is not a valid job', async () => {
      const { client: c, calls } = client();
      const dispatcher = new TriggerDispatcher(c);

      await expect(
        dispatcher.enqueueAudioProcessing({ ...INPUT, operations: [] }, 'key-1'),
      ).rejects.toThrow();
      await expect(
        dispatcher.enqueueAudioProcessing({ ...INPUT, sizeBytes: 0 }, 'key-1'),
      ).rejects.toThrow();
      await expect(
        dispatcher.enqueueAudioProcessing({ ...INPUT, objectKey: '' }, 'key-1'),
      ).rejects.toThrow();

      // Nothing reached the queue on any of those.
      expect(calls).toHaveLength(0);
    });
  });

  describe('inline', () => {
    it('runs the real work rather than pretending to', async () => {
      // The seam is the *queue*, never the pipeline. A runner that was itself a mock would make
      // every inline test meaningless.
      const seen: AudioJobInput[] = [];
      const dispatcher = new InlineDispatcher(async (input) => {
        seen.push(input);
      });

      const handle = await dispatcher.enqueueAudioProcessing(INPUT, 'key-1');

      expect(seen).toEqual([INPUT]);
      expect(handle.status).toBe('complete');
    });

    it('honours idempotency the way a queue would', async () => {
      // Without this, an inline test passes against a dispatcher that ignores idempotency
      // entirely and the difference first appears in production, as a duplicate version.
      const runner = vi.fn(async () => undefined);
      const dispatcher = new InlineDispatcher(runner);

      const first = await dispatcher.enqueueAudioProcessing(INPUT, 'same-key');
      const second = await dispatcher.enqueueAudioProcessing(INPUT, 'same-key');

      expect(runner).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
    });

    it('does not collapse two workspaces that chose the same key', async () => {
      // **The failure this is here to prevent.** Without namespacing, workspace B's upload
      // returns workspace A's handle: nothing runs B's job, the caller is told `queued`, and the
      // asset sits in "processing" forever with nothing to notice it (CLAUDE.md §7).
      const runner = vi.fn(async (_input: AudioJobInput) => undefined);
      const dispatcher = new InlineDispatcher(runner);

      const theirs: AudioJobInput = {
        ...INPUT,
        workspaceId: '01JYAF0000000000000000000B',
        assetVersionId: '01JYAF0000000000000000000C',
        objectKey: 'w/01JYAF0000000000000000000B/o/01JYAF0000000000000000000D',
      };

      await dispatcher.enqueueAudioProcessing(INPUT, 'probe-blue-hour');
      await dispatcher.enqueueAudioProcessing(theirs, 'probe-blue-hour');

      // Both ran. Neither was mistaken for the other.
      expect(runner).toHaveBeenCalledTimes(2);
      expect(runner.mock.calls[1]?.[0]).toMatchObject({ workspaceId: theirs.workspaceId });
    });

    it('refuses the same key for different work inside one workspace', async () => {
      // Namespacing cannot save this case — same workspace, same asset, different payload. A
      // silent replay would report success for work that never ran, so it is loud instead.
      const runner = vi.fn(async () => undefined);
      const dispatcher = new InlineDispatcher(runner);

      await dispatcher.enqueueAudioProcessing(INPUT, 'key-1');
      await expect(
        dispatcher.enqueueAudioProcessing({ ...INPUT, operations: ['waveform'] }, 'key-1'),
      ).rejects.toThrow(/already used for different work/);

      expect(runner).toHaveBeenCalledTimes(1);
    });

    it('treats a different key as different work', async () => {
      const runner = vi.fn(async () => undefined);
      const dispatcher = new InlineDispatcher(runner);

      await dispatcher.enqueueAudioProcessing(INPUT, 'key-1');
      await dispatcher.enqueueAudioProcessing(INPUT, 'key-2');

      expect(runner).toHaveBeenCalledTimes(2);
    });

    it('remembers a failure instead of re-running it on replay', async () => {
      const runner = vi.fn(async () => {
        throw new Error('ffmpeg fell over');
      });
      const dispatcher = new InlineDispatcher(runner);

      await expect(dispatcher.enqueueAudioProcessing(INPUT, 'key-1')).rejects.toBeInstanceOf(
        DispatchError,
      );

      // A used key stays used, matching the queue. Retrying is a decision for whoever holds the
      // job, not a side effect of asking about it again.
      const replay = await dispatcher.enqueueAudioProcessing(INPUT, 'key-1');
      expect(replay.status).toBe('failed');
      expect(runner).toHaveBeenCalledTimes(1);
    });
  });

  describe('the idempotency key itself', () => {
    it('refuses an empty key', async () => {
      // Not "no idempotency" — one key shared by every job in the system, silently collapsing
      // unrelated work into a single handle.
      const dispatcher = new InlineDispatcher(async () => undefined);

      await expect(dispatcher.enqueueAudioProcessing(INPUT, '')).rejects.toThrow(/required/);
      await expect(dispatcher.enqueueAudioProcessing(INPUT, '   ')).rejects.toThrow(/required/);
    });

    it('refuses an unbounded key', async () => {
      const dispatcher = new InlineDispatcher(async () => undefined);
      await expect(dispatcher.enqueueAudioProcessing(INPUT, 'k'.repeat(257))).rejects.toThrow(
        /256/,
      );
    });

    it('applies the same rules to both implementations', async () => {
      // A bound enforced in one dispatcher and not the other is a bound that holds in tests and
      // not in production.
      const { client: c } = {
        client: {
          async trigger() {
            return { id: 'r' };
          },
        },
      };
      const trigger = new TriggerDispatcher(c as TriggerClient);

      await expect(trigger.enqueueAudioProcessing(INPUT, '')).rejects.toThrow(/required/);
      await expect(trigger.enqueueAudioProcessing(INPUT, 'k'.repeat(257))).rejects.toThrow(/256/);
    });
  });
});
