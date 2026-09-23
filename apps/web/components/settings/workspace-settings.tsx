import { Badge, cn, focusRing, transition } from '@youandfriends/ui';
import Link from 'next/link';

import { formatBytes, percentOf } from '@/lib/workspace/format';
import type { WorkspaceSettings } from '@/lib/workspace/settings';

import { MemberList } from './member-list';
import { RenameForm, type RenameAction } from './rename-form';

/**
 * Workspace settings (task `031`).
 *
 * Presentational: everything it shows, and everything the viewer may change, is decided before
 * it renders (`lib/workspace/settings.ts`). It never compares roles — `mayRename` and
 * `mayManageMembers` come from `packages/authz`, so hiding a control here is a courtesy and the
 * server action behind it checks again.
 */
export function WorkspaceSettingsView({
  settings,
  renameAction,
}: {
  settings: WorkspaceSettings;
  renameAction: RenameAction;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-4 md:p-8">
      <header>
        <h1 className="text-title text-foreground font-serif">Settings</h1>
        <p className="text-body text-muted-foreground mt-1 font-sans">{settings.name}</p>
      </header>

      <section aria-labelledby="settings-name" className="flex flex-col gap-3">
        <h2 id="settings-name" className="text-heading text-foreground font-serif">
          Workspace name
        </h2>
        {settings.mayRename ? (
          <RenameForm currentName={settings.name} action={renameAction} />
        ) : (
          <p className="text-body text-foreground font-sans">{settings.name}</p>
        )}
      </section>

      <StorageSection usage={settings.usage} quotaBytes={settings.quotaBytes} />

      <section aria-labelledby="settings-members" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="settings-members" className="text-heading text-foreground font-serif">
            Members
          </h2>
          {settings.mayManageMembers ? (
            <Link
              href="/settings/members"
              className={cn(
                'text-body text-foreground rounded-sm font-sans underline underline-offset-4',
                transition,
                focusRing,
              )}
            >
              Manage members
            </Link>
          ) : null}
        </div>
        <MemberList members={settings.members} />
      </section>
    </div>
  );
}

function StorageSection({
  usage,
  quotaBytes,
}: {
  usage: WorkspaceSettings['usage'];
  quotaBytes: number;
}) {
  const percent = percentOf(usage.usedBytes, quotaBytes);
  const summary = `${formatBytes(usage.usedBytes)} of ${formatBytes(quotaBytes)} used`;
  const nearlyFull = percent >= 90;

  return (
    <section aria-labelledby="settings-storage" className="flex flex-col gap-3">
      <h2 id="settings-storage" className="text-heading text-foreground font-serif">
        Storage
      </h2>
      {/* The figure is the text, and the bar illustrates it — so the state never rests on the
          bar's colour or length alone (docs/DESIGN.md §12). */}
      <p className="text-body text-foreground font-sans tabular-nums">
        {summary} <span className="text-muted-foreground">({percent}%)</span>
      </p>
      <div
        role="meter"
        aria-label="Storage used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={summary}
        className="bg-muted border-border h-2 w-full overflow-hidden rounded-sm border"
      >
        <div
          className={cn('h-full', nearlyFull ? 'bg-destructive' : 'bg-primary')}
          style={{ width: `${percent}%` }}
        />
      </div>
      {nearlyFull ? (
        <Badge variant="problem" className="self-start">
          Nearly full
        </Badge>
      ) : null}
      <p className="text-caption text-muted-foreground font-sans">
        Counts every original, every derived stream, and anything in the trash until it is purged.
        Updated within ten minutes, and straight after an upload. Sizes use 1 GB = 1024³ bytes, so
        Finder may show slightly larger figures.
      </p>
    </section>
  );
}
