import { getSchema } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap';
import { lyricsDocumentSchema, type LyricsDocument } from '@youandfriends/contracts';
import * as Y from 'yjs';

import {
  fromEditorContent,
  lyricsSchemaExtensions,
  toEditorContent,
} from '@/components/lyrics/editor/schema';

/**
 * Lyrics as a Yjs document (task `082`, ADR 0003) — the shape the collaborative editor edits and
 * the realtime room carries. Postgres keeps the Yjs state beside the canonical JSON, and every
 * save **merges** into it: two people's saves arriving in either order, or twice, produce the same
 * document, and neither loses the other's words.
 */

/** The Yjs fragment the editor binds to. */
export const LYRICS_FRAGMENT = 'lyrics';

let cached: Schema | null = null;
function schema(): Schema {
  cached ??= getSchema(lyricsSchemaExtensions);
  return cached;
}

/**
 * A document's Yjs state, **deterministically**: authored by client 0, so two people opening
 * lyrics that were never collaborated on each produce the identical update — which merges into
 * one copy rather than two.
 */
export function yjsFromDocument(document: LyricsDocument): Uint8Array {
  const doc = new Y.Doc();
  doc.clientID = 0;
  prosemirrorJSONToYXmlFragment(
    schema(),
    toEditorContent(document),
    doc.getXmlFragment(LYRICS_FRAGMENT),
  );
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

/** Read a Yjs state back to the canonical document, validated against the contract. */
export function documentFromYjs(state: Uint8Array): LyricsDocument {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const root = yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(LYRICS_FRAGMENT), schema());
  doc.destroy();
  // An empty fragment reads as a document with no sections, which the editor schema allows only
  // transiently; it is simply no lyrics.
  const json = root.childCount === 0 ? { type: 'doc', content: [] } : root.toJSON();
  return lyricsDocumentSchema.parse(fromEditorContent(json));
}

/** Two states' union. Order does not matter, and merging the same state twice changes nothing. */
export function mergeYjs(...states: readonly Uint8Array[]): Uint8Array {
  return Y.mergeUpdates([...states]);
}

/** Base64 without `Buffer`, which the browser does not have. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
