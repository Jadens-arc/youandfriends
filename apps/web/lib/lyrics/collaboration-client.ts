'use client';

import { createClient, type Client } from '@liveblocks/client';
import { LiveblocksYjsProvider } from '@liveblocks/yjs';
import * as React from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';

/**
 * The browser's side of realtime lyrics (task `082`): one Yjs document per open song, carried
 * through its Liveblocks room.
 *
 * A {@link CollaborationSession} is the whole interface the editor needs — the document, the
 * awareness that draws cursors, and a connection status in words — so the real Liveblocks
 * transport ({@link liveblocksSession}) and the in-memory relay the tests drive through genuine
 * disconnections are interchangeable.
 */

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface CollaborationSession {
  readonly awareness: Awareness;
  status(): ConnectionStatus;
  onStatus(listener: (status: ConnectionStatus) => void): () => void;
  destroy(): void;
}

export type SessionFactory = (room: string, doc: Y.Doc) => CollaborationSession;

let client: Client | null = null;

/** The real transport. Room tokens come from `/api/liveblocks/auth`, which decides the access. */
export const liveblocksSession: SessionFactory = (roomId, doc) => {
  client ??= createClient({ authEndpoint: '/api/liveblocks/auth' });
  const { room, leave } = client.enterRoom(roomId, { initialPresence: {} });
  const provider = new LiveblocksYjsProvider(room, doc);
  const map = (status: string): ConnectionStatus =>
    status === 'connected'
      ? 'connected'
      : status === 'reconnecting'
        ? 'reconnecting'
        : status === 'disconnected'
          ? 'offline'
          : 'connecting';
  return {
    awareness: provider.awareness as unknown as Awareness,
    status: () => map(room.getStatus()),
    onStatus: (listener) => room.subscribe('status', (status) => listener(map(status))),
    destroy() {
      provider.destroy();
      leave();
    },
  };
};

/** Which transport the lyrics editor uses — Liveblocks, unless a test supplies another. */
export const SessionFactoryContext = React.createContext<SessionFactory>(liveblocksSession);
