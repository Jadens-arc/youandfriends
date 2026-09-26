import { lyricsPlainText, type LyricsDocument } from '@youandfriends/contracts';
import { inArray } from 'drizzle-orm';

import type { DirectDatabase } from '../client';
import {
  assetVersions,
  assets,
  commentMentions,
  commentReactions,
  comments,
  commentThreads,
  derivatives,
  lyricsDocuments,
  notifications,
  storageObjects,
} from '../schema/index';
import type { Transaction } from '../transaction';
import { SEED_WORKSPACE_ID } from './data';
import type { GeneratedFixture } from './fixtures/audio';
import { deterministicId as id } from './ids';

/**
 * Lyrics, comments, a voice note, and notifications (task `029`) — the tables that did not exist
 * when task `027`'s seed was written. Same rules: deterministic ids, upserts that do nothing on a
 * re-run, and a reset that deletes by id only.
 *
 * The empty cases are deliberate, because they are the layouts that break:
 *
 * - songs with **no lyrics** (Low Tide, Untitled Sketch, and the long-titled one);
 * - a thread with **one comment**, and it is the timestamped one;
 * - Tom's notifications are **all read**, and Priya has **none**.
 *
 * Not seeded: a comment anchored to a lyric range. Its anchor is a Yjs relative position into one
 * particular Yjs state, which this package cannot build without the editor's schema; a made-up
 * one would render as an orphaned anchor, which is not what it would be claiming to show.
 */

const user = (key: string) => id(`user:${key}`);
const song = (key: string) => id(`song:${key}`);

const line = (text: string) => ({
  type: 'lyricsLine' as const,
  content: text === '' ? [] : [{ type: 'text' as const, text }],
});
const section = (
  kind: 'verse' | 'pre_chorus' | 'chorus' | 'bridge' | 'outro',
  lines: readonly string[],
) => ({ type: 'lyricsSection' as const, attrs: { kind }, content: lines.map(line) });

const LYRICS: readonly { readonly songKey: string; readonly document: LyricsDocument }[] = [
  {
    songKey: 'blue-hour-1',
    document: {
      type: 'doc',
      content: [
        section('verse', [
          'Streetlights hum a colour I can’t name',
          'The kettle’s cold, the window’s still the same',
        ]),
        section('pre_chorus', ['And I keep the radio low']),
        section('chorus', ['Blue hour, stay a little longer', 'Blue hour, don’t let the day in']),
        section('verse', ['Your jacket on the chair, a sleeve undone', '']),
        section('bridge', ['Count the seconds, count them twice']),
        section('chorus', ['Blue hour, stay a little longer', 'Blue hour, don’t let the day in']),
      ],
    } as unknown as LyricsDocument,
  },
  {
    songKey: 'blue-hour-2',
    document: {
      type: 'doc',
      content: [
        section('verse', ['Forecast said we’d make it home by nine']),
        section('chorus', ['Careless weather, careless weather']),
      ],
    } as unknown as LyricsDocument,
  },
  {
    // One short section: the layout between "none" and "a full song".
    songKey: 'second-sleep-1',
    document: {
      type: 'doc',
      content: [section('verse', ['Wake at four, the house still breathing'])],
    } as unknown as LyricsDocument,
  },
];

type Thread = {
  readonly key: string;
  readonly songKey: string;
  readonly anchor:
    | { readonly kind: 'general' }
    | { readonly kind: 'timestamp'; readonly mixKey: string; readonly ms: number };
  readonly resolvedBy?: string;
  readonly comments: readonly {
    readonly key: string;
    readonly author: string;
    readonly body: string;
    readonly mentions?: readonly string[];
    readonly voiceNote?: boolean;
  }[];
};

/**
 * Who may say what where follows the seeded grants: Tom is denied on Careless Weather, Priya only
 * views, Sam edits Second Sleep.
 */
const THREADS: readonly Thread[] = [
  {
    key: 'blue-hour-chorus',
    songKey: 'blue-hour-1',
    anchor: { kind: 'general' },
    comments: [
      { key: 'tom-chorus', author: 'tom', body: 'The second chorus drags — can we cut four bars?' },
      {
        key: 'sam-chorus',
        author: 'sam',
        body: `<@${user('avery')}> agree with Tom? I’d keep the pickup.`,
        mentions: ['avery'],
      },
      { key: 'avery-chorus', author: 'avery', body: 'Cut it. Keep the pickup.' },
    ],
  },
  {
    // Inside the fixture's length: the newest Blue Hour version is a three-second tone.
    key: 'blue-hour-snare',
    songKey: 'blue-hour-1',
    anchor: { kind: 'timestamp', mixKey: 'blue-hour-1:4', ms: 1_500 },
    comments: [{ key: 'tom-snare', author: 'tom', body: 'Snare is too loud right here.' }],
  },
  {
    key: 'blue-hour-hum',
    songKey: 'blue-hour-1',
    anchor: { kind: 'general' },
    comments: [{ key: 'sam-hum', author: 'sam', body: '', voiceNote: true }],
  },
  {
    key: 'second-sleep-upload',
    songKey: 'second-sleep-1',
    anchor: { kind: 'general' },
    resolvedBy: 'tom',
    comments: [
      {
        key: 'sam-upload',
        author: 'sam',
        body: 'The newest bounce failed to process — re-export?',
      },
      { key: 'tom-upload', author: 'tom', body: 'Re-exported as WAV. Should be fine now.' },
    ],
  },
];

const VOICE_NOTE = 'sam-hum';

const NOTIFICATIONS = [
  // Avery: unread and read.
  {
    key: 'avery-mentioned',
    recipient: 'avery',
    actor: 'sam',
    event: 'comment.mentioned',
    songKey: 'blue-hour-1',
    detail: { threadId: id('thread:blue-hour-chorus'), commentId: id('comment:sam-chorus') },
    read: false,
    minutesAgo: 30,
  },
  {
    key: 'avery-processed',
    recipient: 'avery',
    actor: null,
    event: 'version.processed',
    songKey: 'blue-hour-1',
    detail: {
      assetVersionId: id('version:blue-hour-1:4'),
      mixVersionId: id('mix:blue-hour-1:4'),
    },
    read: false,
    minutesAgo: 90,
  },
  {
    key: 'avery-snare',
    recipient: 'avery',
    actor: 'tom',
    event: 'comment.created',
    songKey: 'blue-hour-1',
    detail: { threadId: id('thread:blue-hour-snare'), commentId: id('comment:tom-snare') },
    read: true,
    minutesAgo: 60 * 26,
  },
  // Tom: nothing unread.
  {
    key: 'tom-replied',
    recipient: 'tom',
    actor: 'sam',
    event: 'comment.replied',
    songKey: 'blue-hour-1',
    detail: { threadId: id('thread:blue-hour-chorus'), commentId: id('comment:sam-chorus') },
    read: true,
    minutesAgo: 45,
  },
] as const;

function conversationIds() {
  const commentIds = THREADS.flatMap((thread) =>
    thread.comments.map((comment) => id(`comment:${comment.key}`)),
  );
  return {
    lyrics: LYRICS.map((entry) => id(`lyrics:${entry.songKey}`)),
    threads: THREADS.map((thread) => id(`thread:${thread.key}`)),
    comments: commentIds,
    notifications: NOTIFICATIONS.map((notification) => id(`notification:${notification.key}`)),
    voiceAsset: id(`asset:voice:${VOICE_NOTE}`),
    voiceVersion: id(`version:voice:${VOICE_NOTE}`),
    voiceObject: id(`object:voice:${VOICE_NOTE}`),
  };
}

export interface ConversationResult {
  readonly lyrics: number;
  readonly threads: number;
  readonly comments: number;
  readonly voiceNotes: number;
  readonly notifications: number;
}

export async function seedConversation(
  db: DirectDatabase,
  fixture: GeneratedFixture,
): Promise<ConversationResult> {
  const ids = conversationIds();
  const now = Date.now();

  for (const entry of LYRICS) {
    await db
      .insert(lyricsDocuments)
      .values({
        id: id(`lyrics:${entry.songKey}`),
        workspaceId: SEED_WORKSPACE_ID,
        songId: song(entry.songKey),
        document: entry.document,
        plainText: lyricsPlainText(entry.document),
        updatedBy: user('avery'),
      })
      .onConflictDoNothing();
  }

  // The voice note: a generated tone, stored and versioned like any recording.
  await db
    .insert(storageObjects)
    .values({
      id: ids.voiceObject,
      workspaceId: SEED_WORKSPACE_ID,
      bucket: 'youandfriends-originals-dev',
      key: `w/${SEED_WORKSPACE_ID}/o/${ids.voiceObject}`,
      sizeBytes: fixture.sizeBytes,
      checksumSha256: fixture.checksumSha256,
      contentType: fixture.contentType,
    })
    .onConflictDoNothing();
  await db
    .insert(assets)
    .values({
      id: ids.voiceAsset,
      workspaceId: SEED_WORKSPACE_ID,
      songId: song('blue-hour-1'),
      kind: 'voice_note',
      name: 'Voice note',
      createdBy: user('sam'),
    })
    .onConflictDoNothing();
  await db
    .insert(assetVersions)
    .values({
      id: ids.voiceVersion,
      workspaceId: SEED_WORKSPACE_ID,
      assetId: ids.voiceAsset,
      versionNumber: 1,
      storageObjectId: ids.voiceObject,
      uploadedBy: user('sam'),
      durationMs: fixture.durationMs,
      sampleRateHz: fixture.sampleRateHz,
      bitDepth: fixture.bitDepth,
      channels: fixture.channels,
      codec: fixture.codec,
      processingState: 'complete',
    })
    .onConflictDoNothing();
  for (const kind of ['streaming_audio', 'waveform_peaks'] as const) {
    await db
      .insert(derivatives)
      .values({
        id: id(`derivative:voice:${VOICE_NOTE}:${kind}`),
        workspaceId: SEED_WORKSPACE_ID,
        assetVersionId: ids.voiceVersion,
        kind,
        processingState: 'complete',
      })
      .onConflictDoNothing();
  }

  let commentCount = 0;
  for (const [threadIndex, thread] of THREADS.entries()) {
    const threadId = id(`thread:${thread.key}`);
    // Two days back, a thread an hour apart, a reply ten minutes apart: in order, and recent.
    const startedAt = now - 2 * 24 * 60 * 60_000 + threadIndex * 60 * 60_000;
    const lastAt = new Date(startedAt + (thread.comments.length - 1) * 10 * 60_000);
    await db
      .insert(commentThreads)
      .values({
        id: threadId,
        workspaceId: SEED_WORKSPACE_ID,
        songId: song(thread.songKey),
        anchorKind: thread.anchor.kind,
        ...(thread.anchor.kind === 'timestamp'
          ? { anchorVersionId: id(`mix:${thread.anchor.mixKey}`), anchorMs: thread.anchor.ms }
          : {}),
        createdBy: user(thread.comments[0]?.author ?? 'avery'),
        ...(thread.resolvedBy === undefined
          ? {}
          : { resolvedAt: lastAt, resolvedBy: user(thread.resolvedBy) }),
        createdAt: new Date(startedAt),
        updatedAt: lastAt,
      })
      .onConflictDoNothing();
    for (const [index, comment] of thread.comments.entries()) {
      const commentId = id(`comment:${comment.key}`);
      await db
        .insert(comments)
        .values({
          id: commentId,
          workspaceId: SEED_WORKSPACE_ID,
          threadId,
          authorId: user(comment.author),
          body: comment.body,
          voiceNoteAssetId: comment.voiceNote === true ? ids.voiceAsset : null,
          createdAt: new Date(startedAt + index * 10 * 60_000),
        })
        .onConflictDoNothing();
      for (const mentioned of comment.mentions ?? []) {
        await db
          .insert(commentMentions)
          .values({
            id: id(`mention:${comment.key}:${mentioned}`),
            workspaceId: SEED_WORKSPACE_ID,
            commentId,
            userId: user(mentioned),
          })
          .onConflictDoNothing();
      }
      commentCount += 1;
    }
  }

  await db
    .insert(commentReactions)
    .values({
      id: id('reaction:avery-heart-tom-chorus'),
      workspaceId: SEED_WORKSPACE_ID,
      commentId: id('comment:tom-chorus'),
      userId: user('avery'),
      reaction: 'heart',
    })
    .onConflictDoNothing();

  for (const notification of NOTIFICATIONS) {
    const createdAt = new Date(now - notification.minutesAgo * 60_000);
    await db
      .insert(notifications)
      .values({
        id: id(`notification:${notification.key}`),
        workspaceId: SEED_WORKSPACE_ID,
        recipientId: user(notification.recipient),
        actorId: notification.actor === null ? null : user(notification.actor),
        event: notification.event,
        targetType: 'song',
        targetId: song(notification.songKey),
        groupKey:
          notification.event === 'comment.mentioned'
            ? `comment.mentioned:${notification.detail.commentId}`
            : notification.event === 'version.processed'
              ? `version.processed:${id('version:blue-hour-1:4')}`
              : `conversation:song:${song(notification.songKey)}`,
        detail: notification.detail,
        readAt: notification.read ? createdAt : null,
        createdAt,
      })
      .onConflictDoNothing();
  }

  return {
    lyrics: LYRICS.length,
    threads: THREADS.length,
    comments: commentCount,
    voiceNotes: 1,
    notifications: NOTIFICATIONS.length,
  };
}

/**
 * Delete what `seedConversation` wrote, by id, inside `reset`'s transaction. Comments go before
 * the voice note they carry; mentions and reactions go with their comments.
 */
export async function resetConversation(tx: Transaction): Promise<void> {
  const ids = conversationIds();
  await tx.delete(notifications).where(inArray(notifications.id, ids.notifications));
  await tx.delete(comments).where(inArray(comments.id, ids.comments));
  await tx.delete(commentThreads).where(inArray(commentThreads.id, ids.threads));
  await tx.delete(lyricsDocuments).where(inArray(lyricsDocuments.id, ids.lyrics));
  await tx.delete(derivatives).where(inArray(derivatives.assetVersionId, [ids.voiceVersion]));
  await tx.delete(assetVersions).where(inArray(assetVersions.id, [ids.voiceVersion]));
  await tx.delete(assets).where(inArray(assets.id, [ids.voiceAsset]));
  await tx.delete(storageObjects).where(inArray(storageObjects.id, [ids.voiceObject]));
}
