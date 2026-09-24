import type { LyricsDocument } from '@youandfriends/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  AUTOSAVE_DEBOUNCE_MS,
  createAutosave,
  OFFLINE_RETRY_MS,
  type SaveOutcome,
  type SaveState,
} from '../autosave';

const doc = (text: string): LyricsDocument => ({
  type: 'doc',
  content: [
    {
      type: 'lyricsSection',
      attrs: { kind: 'verse' },
      content: [{ type: 'lyricsLine', content: [{ type: 'text', text }] }],
    },
  ],
});

function harness(outcomes: SaveOutcome[]) {
  let clock = 0;
  let timers: { at: number; callback: () => void; id: number }[] = [];
  let nextId = 0;
  const saves: { text: string; baseVersion: number; keepalive: boolean }[] = [];
  const states: SaveState[] = [];
  const autosave = createAutosave({
    version: 3,
    save: async (document, baseVersion, { keepalive }) => {
      const line = document.content[0]?.content[0]?.content?.[0]?.text ?? '';
      saves.push({ text: line, baseVersion, keepalive });
      return outcomes.shift() ?? { ok: true, version: baseVersion + 1 };
    },
    onChange: (state) => states.push(state),
    setTimer: (callback, ms) => {
      nextId += 1;
      timers.push({ at: clock + ms, callback, id: nextId });
      return nextId;
    },
    clearTimer: (handle) => {
      timers = timers.filter((timer) => timer.id !== handle);
    },
  });
  async function advance(ms: number) {
    const target = clock + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const due = timers[0];
      if (due === undefined || due.at > target) break;
      timers.shift();
      clock = due.at;
      due.callback();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    clock = target;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { autosave, saves, states, advance };
}

describe('lyrics autosave (task 080)', () => {
  it('waits for a pause in typing, then saves once against the version it started from', async () => {
    const { autosave, saves, advance } = harness([]);
    autosave.edit(doc('a'));
    await advance(AUTOSAVE_DEBOUNCE_MS - 1);
    autosave.edit(doc('ab'));
    await advance(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(saves).toEqual([]);
    expect(autosave.state()).toBe('dirty');
    await advance(1);
    expect(saves).toEqual([{ text: 'ab', baseVersion: 3, keepalive: false }]);
    expect(autosave.state()).toBe('saved');
    expect(autosave.version()).toBe(4);
  });

  it('saves at once on blur or page hide, with keepalive when the page is going', async () => {
    const { autosave, saves } = harness([]);
    autosave.edit(doc('last line'));
    await autosave.flush({ keepalive: true });
    expect(saves).toEqual([{ text: 'last line', baseVersion: 3, keepalive: true }]);
    await autosave.flush();
    expect(saves).toHaveLength(1); // Nothing waiting, nothing sent.
  });

  it('sends what was typed during a save right after it, on the new version', async () => {
    const releases: ((outcome: SaveOutcome) => void)[] = [];
    const sent: { text: string; baseVersion: number }[] = [];
    const autosave = createAutosave({
      version: 3,
      save: (document, baseVersion) => {
        sent.push({ text: document.content[0]?.content[0]?.content?.[0]?.text ?? '', baseVersion });
        return new Promise((resolve) => releases.push(resolve));
      },
      setTimer: (callback) => {
        queueMicrotask(callback);
        return 0;
      },
      clearTimer: () => undefined,
    });
    autosave.edit(doc('one'));
    const first = autosave.flush();
    await Promise.resolve();
    expect(autosave.state()).toBe('saving');
    autosave.edit(doc('two')); // Typed while "one" is on its way.
    releases[0]?.({ ok: true, version: 4 });
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).toEqual([
      { text: 'one', baseVersion: 3 },
      { text: 'two', baseVersion: 4 },
    ]);
    releases[1]?.({ ok: true, version: 5 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(autosave.version()).toBe(5);
    expect(autosave.state()).toBe('saved');
  });

  it('says offline, keeps the words, and retries — never "saved"', async () => {
    const { autosave, saves, advance } = harness([{ ok: false, kind: 'offline' }]);
    autosave.edit(doc('kept'));
    await autosave.flush();
    expect(autosave.state()).toBe('offline');
    autosave.edit(doc('kept, and more'));
    expect(autosave.state()).toBe('offline');
    await advance(OFFLINE_RETRY_MS);
    expect(saves.map((save) => save.text)).toEqual(['kept', 'kept, and more']);
    expect(autosave.state()).toBe('saved');
  });

  it('stops on a conflict without overwriting, until rebased on the newer version', async () => {
    const { autosave, saves, advance } = harness([{ ok: false, kind: 'conflict' }]);
    autosave.edit(doc('mine'));
    await autosave.flush();
    expect(autosave.state()).toBe('conflict');
    autosave.edit(doc('still mine'));
    await advance(AUTOSAVE_DEBOUNCE_MS * 3);
    expect(saves).toHaveLength(1);
    autosave.rebase(9);
    expect(autosave.state()).toBe('saved');
    autosave.edit(doc('on top of theirs'));
    await advance(AUTOSAVE_DEBOUNCE_MS);
    expect(saves.at(-1)).toMatchObject({ text: 'on top of theirs', baseVersion: 9 });
  });

  it('stops sending for good when access is gone', async () => {
    const { autosave, saves, advance } = harness([{ ok: false, kind: 'refused' }]);
    autosave.edit(doc('x'));
    await autosave.flush();
    expect(autosave.state()).toBe('refused');
    autosave.edit(doc('y'));
    await advance(OFFLINE_RETRY_MS * 2);
    expect(saves).toHaveLength(1);
  });

  it('never touches web storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { autosave } = harness([]);
    autosave.edit(doc('unpublished'));
    await autosave.flush();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});
