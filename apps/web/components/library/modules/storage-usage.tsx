import { formatBytes, percentOf } from '@/lib/workspace/format';

import { ModuleSection } from './module-section';

/**
 * Workspace storage against its quota. Shown to anyone who may see workspace settings — the
 * same gate the settings page uses, so the library never reveals more than settings would —
 * and to nobody else: the caller passes `null` for a scope-limited collaborator.
 */
export function StorageUsage({
  usage,
}: {
  readonly usage: { readonly usedBytes: number; readonly quotaBytes: number } | null;
}) {
  if (usage === null) return null;
  const percent = percentOf(usage.usedBytes, usage.quotaBytes);
  const label = `${formatBytes(usage.usedBytes)} of ${formatBytes(usage.quotaBytes)} used`;

  return (
    <ModuleSection title="Storage" empty={null}>
      <div
        role="meter"
        aria-label="Workspace storage"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={label}
        className="bg-border-subtle h-1.5 w-full overflow-hidden rounded-full"
      >
        <div className="bg-olive h-full rounded-full" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-caption text-muted-foreground tabular font-sans">{label}</p>
    </ModuleSection>
  );
}
