import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import * as Y from 'yjs';

import type {
  CollaborationSession,
  ConnectionStatus,
  SessionFactory,
} from '../collaboration-client';

/**
 * An in-memory stand-in for a Liveblocks room — a **test adapter** (CLAUDE.md §7), used to drive
 * the editor and save path through the things that go wrong in real rooms: simultaneous edits,
 * and a connection that genuinely drops while both sides keep typing, then comes back.
 *
 * Disconnected means disconnected: no updates cross, in either direction, until `reconnect`,
 * which then exchanges only what each side is missing (state-vector diffs), as a Yjs provider
 * does on resync.
 */
export function createRelay() {
  const peers = new Set<Peer>();
  const origin = Symbol('relay');

  interface Peer {
    readonly room: string;
    readonly doc: Y.Doc;
    readonly awareness: Awareness;
    connected: boolean;
    status: ConnectionStatus;
    readonly listeners: Set<(status: ConnectionStatus) => void>;
    readonly teardown: () => void;
  }

  function setStatus(peer: Peer, status: ConnectionStatus) {
    peer.status = status;
    for (const listener of peer.listeners) listener(status);
  }

  function others(peer: Peer) {
    return [...peers].filter(
      (other) => other !== peer && other.room === peer.room && other.connected,
    );
  }

  function sync(a: Peer, b: Peer) {
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b.doc)), origin);
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc, Y.encodeStateVector(a.doc)), origin);
    const ids = (p: Peer) => [...p.awareness.getStates().keys()];
    applyAwarenessUpdate(b.awareness, encodeAwarenessUpdate(a.awareness, ids(a)), origin);
    applyAwarenessUpdate(a.awareness, encodeAwarenessUpdate(b.awareness, ids(b)), origin);
  }

  const factory: SessionFactory = (room, doc) => {
    const awareness = new Awareness(doc);
    const onUpdate = (update: Uint8Array, from: unknown) => {
      if (from === origin || !peer.connected) return;
      for (const other of others(peer)) Y.applyUpdate(other.doc, update, origin);
    };
    const onAwareness = (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      from: unknown,
    ) => {
      if (from === origin || !peer.connected) return;
      const changed = [...added, ...updated, ...removed];
      for (const other of others(peer)) {
        applyAwarenessUpdate(other.awareness, encodeAwarenessUpdate(awareness, changed), origin);
      }
    };
    doc.on('update', onUpdate);
    awareness.on('update', onAwareness);
    const peer: Peer = {
      room,
      doc,
      awareness,
      connected: true,
      status: 'connected',
      listeners: new Set(),
      teardown: () => {
        doc.off('update', onUpdate);
        awareness.off('update', onAwareness);
      },
    };
    peers.add(peer);
    for (const other of others(peer)) sync(peer, other);
    const session: CollaborationSession = {
      awareness,
      status: () => peer.status,
      onStatus(listener) {
        peer.listeners.add(listener);
        return () => peer.listeners.delete(listener);
      },
      destroy() {
        for (const other of others(peer)) {
          removeAwarenessStates(other.awareness, [awareness.clientID], origin);
        }
        peer.teardown();
        peers.delete(peer);
        awareness.destroy();
      },
    };
    return session;
  };

  return {
    factory,
    /** Every session opened so far on this relay, oldest first. */
    count: () => peers.size,
    disconnect(doc: Y.Doc) {
      const peer = [...peers].find((candidate) => candidate.doc === doc);
      if (peer === undefined) throw new Error('no such peer');
      for (const other of others(peer)) {
        removeAwarenessStates(other.awareness, [peer.awareness.clientID], origin);
      }
      peer.connected = false;
      setStatus(peer, 'offline');
    },
    reconnect(doc: Y.Doc) {
      const peer = [...peers].find((candidate) => candidate.doc === doc);
      if (peer === undefined) throw new Error('no such peer');
      peer.connected = true;
      for (const other of others(peer)) sync(peer, other);
      setStatus(peer, 'connected');
    },
  };
}
