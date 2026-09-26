import { REACTION_NAMES, type Reaction } from '@youandfriends/contracts';
import { commentReactions, users } from '@youandfriends/db';
import { and, asc, eq, inArray } from 'drizzle-orm';

import type { LibraryContext } from '@/lib/library/context';

/** One reaction on one comment, as the list shows it. */
export interface ReactionView {
  readonly reaction: Reaction;
  readonly count: number;
  /** Whether the person reading reacted this way. */
  readonly mine: boolean;
  /** Who reacted, by name, earliest first. */
  readonly people: readonly string[];
}

/** Each comment's reactions, in the fixed order of the set. */
export async function reactionsOf(
  context: LibraryContext,
  commentIds: readonly string[],
): Promise<Map<string, ReactionView[]>> {
  const byComment = new Map<string, ReactionView[]>();
  if (commentIds.length === 0) return byComment;
  const rows = await context.db
    .select({
      commentId: commentReactions.commentId,
      reaction: commentReactions.reaction,
      userId: commentReactions.userId,
      name: users.displayName,
    })
    .from(commentReactions)
    .innerJoin(users, eq(users.id, commentReactions.userId))
    .where(
      and(
        eq(commentReactions.workspaceId, context.workspaceId),
        inArray(commentReactions.commentId, [...commentIds]),
      ),
    )
    .orderBy(asc(commentReactions.createdAt), asc(commentReactions.id));
  const grouped = new Map<string, Map<Reaction, { people: string[]; mine: boolean }>>();
  for (const row of rows) {
    const forComment = grouped.get(row.commentId) ?? new Map();
    const entry = forComment.get(row.reaction) ?? { people: [], mine: false };
    entry.people.push(row.name);
    if (row.userId === context.userId) entry.mine = true;
    forComment.set(row.reaction, entry);
    grouped.set(row.commentId, forComment);
  }
  for (const [commentId, forComment] of grouped) {
    byComment.set(
      commentId,
      REACTION_NAMES.flatMap((reaction) => {
        const entry = forComment.get(reaction);
        return entry === undefined
          ? []
          : [{ reaction, count: entry.people.length, mine: entry.mine, people: entry.people }];
      }),
    );
  }
  return byComment;
}
