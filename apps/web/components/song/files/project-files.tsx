'use client';

import { Badge, cn, focusRing } from '@youandfriends/ui';
import {
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileMusic,
  FileText,
  Folder,
  type LucideIcon,
} from 'lucide-react';
import * as React from 'react';

import { formatRelative } from '@/lib/library/format';
import { FILE_TYPE_LABELS, FILE_TYPES, fileTypeOf, type FileType } from '@/lib/songs/file-types';
import { formatBytes } from '@/lib/songs/format';
import type { SongFile } from '@/lib/songs/workspace';

import { displayFolder, FileActions } from './file-actions';

const TYPE_ICON: Readonly<Record<FileType, LucideIcon>> = {
  audio: FileAudio,
  archive: FileArchive,
  midi: FileMusic,
  image: FileImage,
  document: FileText,
  other: File,
};

export type FileSort = 'name' | 'newest' | 'size';

export interface FileFilter {
  readonly tag: string | null;
  readonly type: FileType | 'all';
  readonly sort: FileSort;
}

/** Filter and sort, pure — the same rules the list shows, testable without rendering. */
export function applyFilter(files: readonly SongFile[], filter: FileFilter): SongFile[] {
  const tag = filter.tag?.toLocaleLowerCase('en') ?? null;
  const kept = files.filter(
    (file) =>
      (tag === null || file.tags.some((candidate) => candidate.toLocaleLowerCase('en') === tag)) &&
      (filter.type === 'all' || fileTypeOf(file.name) === filter.type),
  );
  const byName = (a: SongFile, b: SongFile) =>
    a.name.localeCompare(b.name, 'en', { numeric: true });
  return kept.sort((a, b) => {
    if (filter.sort === 'newest')
      return (b.uploadedAt?.getTime() ?? 0) - (a.uploadedAt?.getTime() ?? 0) || byName(a, b);
    if (filter.sort === 'size') return (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0) || byName(a, b);
    return byName(a, b);
  });
}

interface FolderNode {
  readonly name: string;
  readonly path: string;
  readonly files: SongFile[];
  readonly children: Map<string, FolderNode>;
}

/** Nest files under their folder paths: `/A/B/` becomes A → B. */
export function buildTree(files: readonly SongFile[]): FolderNode {
  const root: FolderNode = { name: '', path: '', files: [], children: new Map() };
  for (const file of files) {
    let node = root;
    const segments = displayFolder(file.folderPath).split('/').filter(Boolean);
    for (const [index, segment] of segments.entries()) {
      const path = `/${segments.slice(0, index + 1).join('/')}/`;
      let child = node.children.get(segment);
      if (child === undefined) {
        child = { name: segment, path, files: [], children: new Map() };
        node.children.set(segment, child);
      }
      node = child;
    }
    node.files.push(file);
  }
  return root;
}

function FileLine({
  file,
  canEdit,
  folders,
  knownTags,
  now,
  onTag,
}: {
  readonly file: SongFile;
  readonly canEdit: boolean;
  readonly folders: readonly string[];
  readonly knownTags: readonly string[];
  readonly now: Date;
  readonly onTag: (tag: string) => void;
}) {
  const type = fileTypeOf(file.name);
  const Icon = TYPE_ICON[type];
  return (
    <li className="flex min-h-11 items-center gap-3 px-3 py-2">
      <Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-body text-foreground truncate font-sans">
          {file.name}
          <span className="sr-only">, {FILE_TYPE_LABELS[type]}</span>
        </p>
        <p className="text-caption text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 font-sans">
          <span className="tabular">{formatBytes(file.sizeBytes)}</span>
          {file.uploadedAt === null ? null : (
            <>
              <span aria-hidden>·</span>
              <time dateTime={file.uploadedAt.toISOString()}>
                {formatRelative(file.uploadedAt, now)}
              </time>
            </>
          )}
          {file.uploaderName === null ? null : (
            <>
              <span aria-hidden>·</span>
              <span>{file.uploaderName}</span>
            </>
          )}
          <span aria-hidden>·</span>
          <span>{file.versionCount === 1 ? '1 version' : `${file.versionCount} versions`}</span>
          {file.tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onTag(tag)}
              className={cn('rounded-sm', focusRing)}
              aria-label={`Show files tagged ${tag}`}
            >
              <Badge>{tag}</Badge>
            </button>
          ))}
        </p>
      </div>
      {canEdit ? <FileActions file={file} folders={folders} knownTags={knownTags} /> : null}
    </li>
  );
}

function FolderView(props: {
  readonly node: FolderNode;
  readonly depth: number;
  readonly lineProps: Omit<React.ComponentProps<typeof FileLine>, 'file'>;
}) {
  const { node, depth, lineProps } = props;
  const children = [...node.children.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'en', { numeric: true }),
  );
  const content = (
    <>
      {children.map((child) => (
        <li key={child.path}>
          <details open className="group">
            <summary
              className={cn(
                'text-body text-foreground flex min-h-10 cursor-pointer items-center gap-2 px-3 font-sans',
                focusRing,
              )}
            >
              <Folder aria-hidden className="text-muted-foreground size-4" />
              {child.name}
            </summary>
            <div className="border-border-subtle ml-5 border-l">
              <FolderView node={child} depth={depth + 1} lineProps={lineProps} />
            </div>
          </details>
        </li>
      ))}
      {node.files.map((file) => (
        <FileLine key={file.id} file={file} {...lineProps} />
      ))}
    </>
  );
  return <ul className="divide-border-subtle divide-y">{content}</ul>;
}

/**
 * The one Project Files area (task `057`, `docs/DESIGN.md` §2): Logic sessions, MPC folders,
 * ZIPs, MIDI, presets, and notes, all together — organized by the person's own nested folders
 * and workspace-wide tags, never by a section the product decided a DAW deserves.
 */
export function ProjectFiles({
  files,
  canEdit,
  knownTags,
  now = new Date(),
}: {
  readonly files: readonly SongFile[];
  readonly canEdit: boolean;
  readonly knownTags: readonly string[];
  readonly now?: Date;
}) {
  const [filter, setFilter] = React.useState<FileFilter>({ tag: null, type: 'all', sort: 'name' });
  const shown = applyFilter(files, filter);
  const folders = [
    ...new Set(files.map((file) => file.folderPath).filter((path) => path !== '')),
  ].sort();
  const tagsInUse = [...new Set(files.flatMap((file) => file.tags))].sort((a, b) =>
    a.localeCompare(b),
  );
  const selectClass = cn(
    'border-border bg-card text-caption text-foreground h-9 rounded-md border px-2 font-sans',
    focusRing,
  );

  if (files.length === 0) {
    return (
      <p className="text-caption text-muted-foreground px-3 py-3 font-sans italic">
        Sessions, archives, MIDI, and notes will live here.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      <div
        className="border-border-subtle flex flex-wrap items-center gap-2 border-b px-3 py-2"
        role="group"
        aria-label="Filter project files"
      >
        <label className="text-caption text-muted-foreground flex items-center gap-1.5 font-sans">
          Tag
          <select
            className={selectClass}
            value={filter.tag ?? ''}
            onChange={(event) =>
              setFilter({ ...filter, tag: event.target.value === '' ? null : event.target.value })
            }
          >
            <option value="">Any</option>
            {tagsInUse.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </label>
        <label className="text-caption text-muted-foreground flex items-center gap-1.5 font-sans">
          Type
          <select
            className={selectClass}
            value={filter.type}
            onChange={(event) =>
              setFilter({ ...filter, type: event.target.value as FileFilter['type'] })
            }
          >
            <option value="all">Any</option>
            {FILE_TYPES.map((type) => (
              <option key={type} value={type}>
                {FILE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-caption text-muted-foreground flex items-center gap-1.5 font-sans">
          Sort
          <select
            className={selectClass}
            value={filter.sort}
            onChange={(event) => setFilter({ ...filter, sort: event.target.value as FileSort })}
          >
            <option value="name">Name</option>
            <option value="newest">Newest</option>
            <option value="size">Largest</option>
          </select>
        </label>
        <p className="text-caption text-muted-foreground ml-auto font-sans" aria-live="polite">
          {shown.length === files.length
            ? `${files.length} files`
            : `${shown.length} of ${files.length} files`}
        </p>
      </div>
      {shown.length === 0 ? (
        <p className="text-caption text-muted-foreground px-3 py-3 font-sans italic">
          No files match.
        </p>
      ) : (
        <FolderView
          node={buildTree(shown)}
          depth={0}
          lineProps={{
            canEdit,
            folders,
            knownTags,
            now,
            onTag: (tag) => setFilter({ ...filter, tag }),
          }}
        />
      )}
    </div>
  );
}
