import type { ProcessingState, WorkStatus } from '@youandfriends/contracts';
import { Badge } from '@youandfriends/ui';
import { AlertTriangle, CheckCircle2, CircleDashed, Loader2 } from 'lucide-react';

import { PROCESSING_LABELS, WORK_STATUS_LABELS } from '@/lib/songs/format';

/**
 * A song's or project's work status. Always a word: the status is never a colour on its own
 * (`docs/DESIGN.md` §12).
 */
export function WorkStatusBadge({ status }: { readonly status: WorkStatus }) {
  return (
    <Badge variant={status === 'done' ? 'current' : 'neutral'}>
      <span className="sr-only">Status: </span>
      {WORK_STATUS_LABELS[status]}
    </Badge>
  );
}

const PROCESSING_ICON = {
  queued: CircleDashed,
  running: Loader2,
  complete: CheckCircle2,
  failed: AlertTriangle,
} as const;

const PROCESSING_VARIANT = {
  queued: 'neutral',
  running: 'attention',
  complete: 'current',
  failed: 'problem',
} as const;

/** Processing state: an icon *and* a word, so neither colour nor shape carries it alone. */
export function ProcessingBadge({ state }: { readonly state: ProcessingState }) {
  const Icon = PROCESSING_ICON[state];
  return (
    <Badge variant={PROCESSING_VARIANT[state]}>
      <Icon aria-hidden className="size-3.5" />
      {PROCESSING_LABELS[state]}
    </Badge>
  );
}
