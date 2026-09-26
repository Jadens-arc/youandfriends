'use client';

import { cn, focusRing } from '@youandfriends/ui';
import * as React from 'react';

import { segmentsOf } from '@/lib/comments/mention-format';
import type { MentionView } from '@/lib/comments/store';

/**
 * A comment's words with its mentions (task `094`). A mention shows the person's name as it is
 * now, and pressing it shows the conversation with them. There is no profile page to send it to,
 * and the members page is the owner's. A reference to someone the comment did not reach reads
 * "@someone": readers are not told who else exists.
 */
export function MentionText({
  body,
  mentions,
  onPerson,
}: {
  readonly body: string;
  readonly mentions: readonly MentionView[] | undefined;
  readonly onPerson?: ((person: MentionView) => void) | undefined;
}) {
  return (
    <>
      {segmentsOf(body, mentions).map((segment, index) => {
        if (segment.kind === 'text')
          return <React.Fragment key={index}>{segment.text}</React.Fragment>;
        if (segment.name === null) {
          return (
            <span key={index} className="text-muted-foreground">
              @someone
            </span>
          );
        }
        const person = { id: segment.id, name: segment.name };
        return onPerson === undefined ? (
          <span key={index} className="text-primary font-medium" data-mention={segment.id}>
            @{segment.name}
          </span>
        ) : (
          <button
            key={index}
            type="button"
            data-mention={segment.id}
            onClick={() => onPerson(person)}
            aria-label={`@${segment.name} — show the conversation with ${segment.name}`}
            className={cn(
              'text-primary rounded-sm font-medium underline-offset-2 hover:underline',
              focusRing,
            )}
          >
            @{segment.name}
          </button>
        );
      })}
    </>
  );
}
