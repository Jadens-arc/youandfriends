import { cn } from '@youandfriends/ui';
import { FileArchive, FileAudio, FileImage, type LucideIcon } from 'lucide-react';

import { formatBytes } from '@/lib/songs/format';
import type { FileGroup, SongFile, SongFileGroups } from '@/lib/songs/workspace';
import { FILE_GROUPS } from '@/lib/songs/workspace';

import { ProcessingBadge } from './status-badge';

export const FILE_GROUP_LABELS: Readonly<Record<FileGroup, string>> = {
  masters: 'Masters',
  stems: 'Stems & Samples',
  project_files: 'Project Files',
  artwork: 'Artwork',
};

const EMPTY: Readonly<Record<FileGroup, string>> = {
  masters: 'No masters yet.',
  stems: 'No stems or samples yet.',
  project_files: 'Sessions, archives, MIDI, and notes will live here.',
  artwork: 'No artwork yet.',
};

const GROUP_ICON = {
  masters: FileAudio,
  stems: FileAudio,
  project_files: FileArchive,
  artwork: FileImage,
} as const satisfies Record<FileGroup, LucideIcon>;

function FileRow({ file, group }: { readonly file: SongFile; readonly group: FileGroup }) {
  const Icon = GROUP_ICON[group];
  return (
    <li className="flex min-h-11 items-center gap-3 px-3 py-2">
      <Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-body text-foreground truncate font-sans">{file.name}</p>
        <p className="text-caption text-muted-foreground flex flex-wrap items-center gap-x-2 font-sans">
          <span className="tabular">{formatBytes(file.sizeBytes)}</span>
          {file.versionCount > 1 ? (
            <>
              <span aria-hidden>·</span>
              <span>{file.versionCount} versions</span>
            </>
          ) : null}
          {file.tags.length > 0 ? (
            <>
              <span aria-hidden>·</span>
              <span>
                <span className="sr-only">Tags: </span>
                {file.tags.join(', ')}
              </span>
            </>
          ) : null}
        </p>
      </div>
      {file.processingState !== null &&
      file.processingState !== 'complete' &&
      group !== 'project_files' ? (
        <ProcessingBadge state={file.processingState} />
      ) : null}
    </li>
  );
}

/**
 * Project Files, organized by the user's own subfolders (`assets.folder_path`). One area, never
 * a Logic section and an MPC section (`docs/DESIGN.md` §2).
 */
function ProjectFilesTree({ files }: { readonly files: readonly SongFile[] }) {
  const byFolder = new Map<string, SongFile[]>();
  for (const file of files) {
    const list = byFolder.get(file.folderPath) ?? [];
    list.push(file);
    byFolder.set(file.folderPath, list);
  }
  const folders = [...byFolder.keys()].sort();

  return (
    <div className="flex flex-col gap-3">
      {folders.map((folder) => (
        <div key={folder || 'root'}>
          {folder === '' ? null : (
            <h4 className="text-caption text-muted-foreground px-3 pb-1 font-mono">{folder}</h4>
          )}
          <ul className="divide-border-subtle divide-y">
            {(byFolder.get(folder) ?? []).map((file) => (
              <FileRow key={file.id} file={file} group="project_files" />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** The four fixed groups, always in this order, each with its own heading. */
export function FileGroups({ files }: { readonly files: SongFileGroups }) {
  return (
    <div className="flex flex-col gap-6">
      {FILE_GROUPS.map((group) => {
        const items = files[group];
        const headingId = `file-group-${group}`;
        return (
          <section key={group} aria-labelledby={headingId} data-file-group={group}>
            <h3
              id={headingId}
              className="text-heading text-foreground mb-2 flex items-baseline gap-2 font-serif"
            >
              {FILE_GROUP_LABELS[group]}
              <span className="text-caption text-muted-foreground tabular font-sans">
                {items.length}
              </span>
            </h3>
            <div
              className={cn(
                'border-border bg-card rounded-md border',
                items.length === 0 && 'border-dashed',
              )}
            >
              {items.length === 0 ? (
                <p className="text-caption text-muted-foreground px-3 py-3 font-sans italic">
                  {EMPTY[group]}
                </p>
              ) : group === 'project_files' ? (
                <ProjectFilesTree files={items} />
              ) : (
                <ul className="divide-border-subtle divide-y">
                  {items.map((file) => (
                    <FileRow key={file.id} file={file} group={group} />
                  ))}
                </ul>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
