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
 * Lyrics, comments, a voice note, and notifications for the seeded workspace (task `029`) — the
 * tables that did not exist when task `027` wrote the seed. Same rules as the rest of it: every
 * row has a deterministic id, a re-run does nothing new, `--reset` removes exactly these rows.
 *
 * The empty cases are deliberate: "Low Tide" and "Untitled Sketch" have no lyrics, "Careless
 * Weather" has one thread with one comment, Sam has no notifications, and Tom's are all read.
 */

type Line = string;
interface Section {
  readonly kind: 'verse' | 'chorus' | 'bridge' | 'intro' | 'outro' | 'pre_chorus' | 'freeform';
  readonly label?: string;
  readonly lines: readonly Line[];
}

/** Lyrics for three of the six songs. All invented here; no real song's words. */
export const SEED_LYRICS: Readonly<Record<string, readonly Section[]>> = {
  'blue-hour-1': [
    {
      kind: 'verse',
      lines: [
        'Streetlights blinking on one by one',
        'The kettle sings like it knows I am gone',
        'Half a melody under my breath',
      ],
    },
    {
      kind: 'chorus',
      lines: ['Blue hour, hold the door', 'Blue hour, just a little more'],
    },
    {
      kind: 'verse',
      lines: ['Tape hiss and a borrowed guitar', 'Counting the cars from the end of the bar'],
    },
    { kind: 'chorus', lines: ['Blue hour, hold the door', 'Blue hour, just a little more'] },
    { kind: 'bridge', label: 'Bridge — half time', lines: ['Slow it down, let it ring'] },
  ],
  'blue-hour-2': [
    { kind: 'intro', lines: ['(humming)'] },
    {
      kind: 'verse',
      lines: ['Careless weather, careless me', 'Forecast says what it wants to be'],
    },
  ],
  'second-sleep-1': [
    { kind: 'freeform', label: 'Notes', lines: ['Rewrite second verse — too wordy?', ''] },
  ],
};

function documentOf(sections: readonly Section[]) {
  return {
    type: 'doc' as const,
    content: sections.map((section) => ({
      type: 'lyricsSection' as const,
      attrs: { kind: section.kind, label: section.label ?? null, timestampMs: null },
      content: section.lines.map((line) => ({
        type: 'lyricsLine' as const,
        ...(line === '' ? {} : { content: [{ type: 'text' as const, text: line }] }),
      })),
    })),
  };
}

function plainTextOf(sections: readonly Section[]): string {
  return sections.map((section) => section.lines.join('\n')).join('\n\n');
}

interface SeedComment {
  readonly key: string;
  readonly author: string;
  readonly body: string;
  /** Minutes after the thread opened. */
  readonly at: number;
  readonly mentions?: readonly string[];
  readonly reactions?: readonly { readonly user: string; readonly emoji: string }[];
  readonly voiceNote?: boolean;
}

interface SeedThread {
  readonly key: string;
  readonly songKey: string;
  readonly anchor:
    | { readonly kind: 'general' }
    | { readonly kind: 'timestamp'; readonly version: number; readonly ms: number }
    | { readonly kind: 'lyric'; readonly quote: string };
  readonly resolvedBy?: string;
  /** Days before the seed's reference date. */
  readonly daysAgo: number;
  readonly comments: readonly SeedComment[];
}

/**
 * Words with `<@…>` are mentions; the token is filled in with the person's seeded id. A
 * timestamp sits inside the fixture's own length (2–3 s), never at an arbitrary second.
 */
export const SEED_THREADS: readonly SeedThread[] = [
  {
    key: 'blue-hour-general',
    songKey: 'blue-hour-1',
    anchor: { kind: 'general' },
    daysAgo: 3,
    comments: [
      {
        key: 'bh-1',
        author: 'tom',
        body: 'This is so close. The second chorus could lift more — double the vocal?',
        at: 0,
        reactions: [
          { user: 'avery', emoji: '👍' },
          { user: 'priya', emoji: '🔥' },
        ],
      },
      {
        key: 'bh-2',
        author: 'priya',
        body: '@avery what do you think about bringing the piano in earlier?',
        at: 45,
        mentions: ['avery'],
      },
      { key: 'bh-3', author: 'avery', body: 'Trying it tonight.', at: 90 },
    ],
  },
  {
    key: 'blue-hour-moment',
    songKey: 'blue-hour-1',
    anchor: { kind: 'timestamp', version: 4, ms: 1_500 },
    daysAgo: 1,
    comments: [
      { key: 'bhm-1', author: 'sam', body: 'Click right here — can you hear it?', at: 0 },
      { key: 'bhm-2', author: 'tom', body: '', at: 20, voiceNote: true },
    ],
  },
  {
    key: 'blue-hour-lyric',
    songKey: 'blue-hour-1',
    // Seeded lyrics have no collaborative state yet, so this anchor cannot be placed in the
    // text: it shows as a comment whose words have changed, which is a layout worth seeing.
    anchor: { kind: 'lyric', quote: 'The kettle sings like it knows I am gone' },
    daysAgo: 2,
    comments: [{ key: 'bhl-1', author: 'priya', body: 'Love this line. Keep it.', at: 0 }],
  },
  {
    key: 'blue-hour-resolved',
    songKey: 'blue-hour-1',
    anchor: { kind: 'general' },
    resolvedBy: 'avery',
    daysAgo: 6,
    comments: [
      { key: 'bhr-1', author: 'tom', body: 'Bass is a little boomy on v2.', at: 0 },
      { key: 'bhr-2', author: 'avery', body: 'Fixed in v3.', at: 600 },
    ],
  },
  {
    key: 'careless-one',
    songKey: 'blue-hour-2',
    anchor: { kind: 'general' },
    daysAgo: 4,
    comments: [{ key: 'cw-1', author: 'avery', body: 'Rough idea — no rush on this one.', at: 0 }],
  },
];

interface SeedNotification {
  readonly key: string;
  readonly recipient: string;
  readonly actor: string | null;
  readonly event: string;
  readonly songKey: string;
  readonly count: number;
  readonly preview: string | null;
  readonly threadKey?: string;
  readonly version?: number;
  readonly read: boolean;
  readonly hoursAgo: number;
}

/** Avery has unread and read ones; Tom's are all read; Sam has none at all. */
export const SEED_NOTIFICATIONS: readonly SeedNotification[] = [
  {
    key: 'avery-mention',
    recipient: 'avery',
    actor: 'priya',
    event: 'comment.mentioned',
    songKey: 'blue-hour-1',
    count: 1,
    preview: '@Avery what do you think about bringing the piano in earlier?',
    threadKey: 'blue-hour-general',
    read: false,
    hoursAgo: 70,
  },
  {
    key: 'avery-comments',
    recipient: 'avery',
    actor: 'tom',
    event: 'comment.created',
    songKey: 'blue-hour-1',
    count: 3,
    preview: 'Click right here — can you hear it?',
    threadKey: 'blue-hour-moment',
    read: false,
    hoursAgo: 20,
  },
  {
    key: 'avery-processed',
    recipient: 'avery',
    actor: null,
    event: 'version.processed',
    songKey: 'blue-hour-1',
    count: 1,
    preview: 'Version 4',
    version: 4,
    read: true,
    hoursAgo: 100,
  },
  {
    key: 'tom-resolved-thread',
    recipient: 'tom',
    actor: 'avery',
    event: 'comment.replied',
    songKey: 'blue-hour-1',
    count: 1,
    preview: 'Fixed in v3.',
    threadKey: 'blue-hour-resolved',
    read: true,
    hoursAgo: 130,
  },
];

/** The seed's clock: fixed, so a re-run writes the same times. */
const REFERENCE = new Date('2026-09-01T18:00:00Z');
const minutes = (count: number) => count * 60_000;

function voiceNoteIds(thread: SeedThread, comment: SeedComment) {
  const key = `${thread.key}:${comment.key}`;
  return {
    asset: id(`asset:voice:${key}`),
    object: id(`object:voice:${key}`),
    version: id(`version:voice:${key}`),
  };
}

export async function seedConversation(
  db: DirectDatabase,
  fixture: GeneratedFixture,
): Promise<{
  readonly threads: number;
  readonly comments: number;
  readonly notifications: number;
}> {
  const user = (key: string) => id(`user:${key}`);
  const song = (key: string) => id(`song:${key}`);

  for (const [songKey, sections] of Object.entries(SEED_LYRICS)) {
    await db
      .insert(lyricsDocuments)
      .values({
        id: id(`lyrics:${songKey}`),
        workspaceId: SEED_WORKSPACE_ID,
        songId: song(songKey),
        document: documentOf(sections),
        plainText: plainTextOf(sections),
        updatedBy: user('avery'),
      })
      .onConflictDoNothing();
  }

  let commentCount = 0;
  for (const thread of SEED_THREADS) {
    const opened = new Date(REFERENCE.getTime() - thread.daysAgo * 24 * 60 * 60_000);
    const last = thread.comments.at(-1)?.at ?? 0;
    const closed = new Date(opened.getTime() + minutes(last));
    const anchor = thread.anchor;
    await db
      .insert(commentThreads)
      .values({
        id: id(`thread:${thread.key}`),
        workspaceId: SEED_WORKSPACE_ID,
        songId: song(thread.songKey),
        anchorKind: anchor.kind,
        anchorVersionId:
          anchor.kind === 'timestamp' ? id(`mix:${thread.songKey}:${anchor.version}`) : null,
        anchorMs: anchor.kind === 'timestamp' ? anchor.ms : null,
        anchorLyric:
          anchor.kind === 'lyric'
            ? { start: {}, end: {}, quote: anchor.quote, scope: 'line' }
            : null,
        createdBy: user(thread.comments[0]?.author ?? 'avery'),
        resolvedAt: thread.resolvedBy === undefined ? null : closed,
        resolvedBy: thread.resolvedBy === undefined ? null : user(thread.resolvedBy),
        createdAt: opened,
        updatedAt: closed,
      })
      .onConflictDoNothing();

    for (const comment of thread.comments) {
      const at = new Date(opened.getTime() + minutes(comment.at));
      let voiceNoteAssetId: string | null = null;
      if (comment.voiceNote === true) {
        // A generated tone, like every audio fixture here — never a real recording (T9).
        const voice = voiceNoteIds(thread, comment);
        voiceNoteAssetId = voice.asset;
        await db
          .insert(assets)
          .values({
            id: voice.asset,
            workspaceId: SEED_WORKSPACE_ID,
            songId: song(thread.songKey),
            kind: 'voice_note',
            name: 'Voice note.wav',
            createdBy: user(comment.author),
          })
          .onConflictDoNothing();
        await db
          .insert(storageObjects)
          .values({
            id: voice.object,
            workspaceId: SEED_WORKSPACE_ID,
            bucket: 'youandfriends-originals-dev',
            key: `w/${SEED_WORKSPACE_ID}/o/${voice.object}`,
            sizeBytes: fixture.sizeBytes,
            checksumSha256: fixture.checksumSha256,
            contentType: fixture.contentType,
          })
          .onConflictDoNothing();
        await db
          .insert(assetVersions)
          .values({
            id: voice.version,
            workspaceId: SEED_WORKSPACE_ID,
            assetId: voice.asset,
            versionNumber: 1,
            storageObjectId: voice.object,
            uploadedBy: user(comment.author),
            durationMs: fixture.durationMs,
            sampleRateHz: fixture.sampleRateHz,
            bitDepth: fixture.bitDepth,
            channels: fixture.channels,
            codec: fixture.codec,
            processingState: 'complete',
          })
          .onConflictDoNothing();
        await db
          .insert(derivatives)
          .values({
            id: id(`derivative:voice:${thread.key}:${comment.key}`),
            workspaceId: SEED_WORKSPACE_ID,
            assetVersionId: voice.version,
            kind: 'streaming_audio',
            variant: 'aac-192k',
            processingState: 'complete',
          })
          .onConflictDoNothing();
      }
      const commentId = id(`comment:${comment.key}`);
      const body = (comment.mentions ?? []).reduce(
        (words, key) => words.replace(`@${key}`, `<@${user(key)}>`),
        comment.body,
      );
      await db
        .insert(comments)
        .values({
          id: commentId,
          workspaceId: SEED_WORKSPACE_ID,
          threadId: id(`thread:${thread.key}`),
          authorId: user(comment.author),
          body,
          voiceNoteAssetId,
          createdAt: at,
        })
        .onConflictDoNothing();
      for (const key of comment.mentions ?? []) {
        await db
          .insert(commentMentions)
          .values({
            id: id(`mention:${comment.key}:${key}`),
            workspaceId: SEED_WORKSPACE_ID,
            commentId,
            userId: user(key),
            createdAt: at,
          })
          .onConflictDoNothing();
      }
      for (const reaction of comment.reactions ?? []) {
        await db
          .insert(commentReactions)
          .values({
            id: id(`reaction:${comment.key}:${reaction.user}:${reaction.emoji}`),
            workspaceId: SEED_WORKSPACE_ID,
            commentId,
            userId: user(reaction.user),
            emoji: reaction.emoji,
            createdAt: at,
          })
          .onConflictDoNothing();
      }
      commentCount += 1;
    }
  }

  for (const notification of SEED_NOTIFICATIONS) {
    const at = new Date(REFERENCE.getTime() - notification.hoursAgo * 60 * 60_000);
    const link =
      notification.threadKey !== undefined
        ? { threadId: id(`thread:${notification.threadKey}`), tab: 'activity' }
        : notification.version !== undefined
          ? { versionId: id(`mix:${notification.songKey}:${notification.version}`) }
          : null;
    await db
      .insert(notifications)
      .values({
        id: id(`notification:${notification.key}`),
        workspaceId: SEED_WORKSPACE_ID,
        recipientId: user(notification.recipient),
        event: notification.event,
        targetType: 'song',
        targetId: song(notification.songKey),
        // A seeded row is read, or a group of its own: it never collides with a live one.
        groupKey: `seed:${notification.key}`,
        actorId: notification.actor === null ? null : user(notification.actor),
        count: notification.count,
        items: [
          {
            event: notification.event,
            actorId: notification.actor === null ? null : user(notification.actor),
            preview: notification.preview,
            link,
            at: at.toISOString(),
          },
        ],
        readAt: notification.read ? at : null,
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoNothing();
  }

  return {
    threads: SEED_THREADS.length,
    comments: commentCount,
    notifications: SEED_NOTIFICATIONS.length,
  };
}

/** Remove exactly what {@link seedConversation} wrote. Runs inside `reset`'s transaction. */
export async function resetConversation(tx: Transaction): Promise<void> {
  const voice = SEED_THREADS.flatMap((thread) =>
    thread.comments
      .filter((comment) => comment.voiceNote === true)
      .map((comment) => voiceNoteIds(thread, comment)),
  );
  await tx.delete(notifications).where(
    inArray(
      notifications.id,
      SEED_NOTIFICATIONS.map((n) => id(`notification:${n.key}`)),
    ),
  );
  // Mentions and reactions cascade from their comments; comments from their threads.
  await tx.delete(commentThreads).where(
    inArray(
      commentThreads.id,
      SEED_THREADS.map((thread) => id(`thread:${thread.key}`)),
    ),
  );
  await tx.delete(lyricsDocuments).where(
    inArray(
      lyricsDocuments.id,
      Object.keys(SEED_LYRICS).map((songKey) => id(`lyrics:${songKey}`)),
    ),
  );
  if (voice.length > 0) {
    await tx.delete(derivatives).where(
      inArray(
        derivatives.assetVersionId,
        voice.map((ids) => ids.version),
      ),
    );
    await tx.delete(assetVersions).where(
      inArray(
        assetVersions.id,
        voice.map((ids) => ids.version),
      ),
    );
    await tx.delete(assets).where(
      inArray(
        assets.id,
        voice.map((ids) => ids.asset),
      ),
    );
    await tx.delete(storageObjects).where(
      inArray(
        storageObjects.id,
        voice.map((ids) => ids.object),
      ),
    );
  }
}
