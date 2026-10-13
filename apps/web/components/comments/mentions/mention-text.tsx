import type { MentionView } from '@/lib/comments/store';

import { segments } from './tokens';

/**
 * A comment's words with its mentions shown by name (task `094`). The name is looked up now, so
 * a rename shows the new name. Everything else is text — React escapes it, never markup.
 */
export function MentionText({
  body,
  mentions,
}: {
  readonly body: string;
  readonly mentions: readonly MentionView[];
}) {
  const names = new Map(mentions.map((mention) => [mention.userId, mention.displayName]));
  return (
    <>
      {segments(body).map((part, index) =>
        part.kind === 'text' ? (
          <span key={index}>{part.text}</span>
        ) : (
          <span key={index} data-mention={part.userId} className="text-olive-text font-medium">
            @{names.get(part.userId) ?? 'someone'}
          </span>
        ),
      )}
    </>
  );
}
