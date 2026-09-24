'use client';

import * as React from 'react';

import { createAudioElementAdapter } from '@/lib/player/audio-element';
import { handlePlayerKey } from '@/lib/player/shortcuts';
import { getPlayer } from '@/lib/player/store';

/**
 * The one `<audio>` element (task `070`). Rendered once, by the workspace layout, above the route
 * segment — so navigation never remounts it and playback never stops for a route change
 * (`docs/DESIGN.md` §1). Every control anywhere talks to it through the player store.
 *
 * Hidden: the controls are the player bar's (task `071`), and a second, native set of controls
 * would be a second place to press play.
 */
export function AudioHost() {
  const ref = React.useRef<HTMLAudioElement>(null);
  React.useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const player = getPlayer();
    const detach = player.attach(createAudioElementAdapter(element));
    // Last session's queue, re-authorized by the server before any of it is shown (task `073`).
    void player.restoreQueue();
    return detach;
  }, []);

  // The player's keyboard shortcuts, workspace-wide — except where the key belongs to whatever
  // has focus: a field, the lyrics editor, a slider, a button (`lib/player/shortcuts.ts`).
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (handlePlayerKey(event, getPlayer())) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Music, not speech: there is no caption track to offer.
  return <audio ref={ref} data-player-audio hidden />;
}
