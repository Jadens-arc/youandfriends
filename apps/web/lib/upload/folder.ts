/**
 * Reading a folder the person picked or dropped (task `054`), preserving relative paths.
 *
 * Two ways in, one shape out. A `<input webkitdirectory>` gives a flat `FileList` whose files
 * carry `webkitRelativePath`; a drop gives `DataTransferItem`s whose directory entries have to be
 * walked. Both become `{ file, relativePath }` pairs rooted *inside* the chosen folder — the
 * folder's own name is the snapshot's name, not a path segment on every entry.
 *
 * Nothing here decides what is safe: `relativePath` is exactly what the browser said, and
 * `manifest.ts` normalizes and judges it. Nothing here writes to the person's disk either — a
 * browser cannot, and the principle is stated because the Mac agent can.
 */

export interface PickedFile {
  readonly file: File;
  /** As the browser reported it, below the chosen folder. Untrusted. */
  readonly relativePath: string;
}

export interface PickedFolder {
  readonly name: string;
  readonly files: readonly PickedFile[];
}

/** Split "Root/a/b.wav" into the root's name and "a/b.wav". */
function splitRoot(path: string): { root: string; rest: string } {
  const index = path.indexOf('/');
  return index === -1
    ? { root: '', rest: path }
    : { root: path.slice(0, index), rest: path.slice(index + 1) };
}

/** From `<input type="file" webkitdirectory>`. */
export function folderFromFileList(files: FileList | readonly File[]): PickedFolder {
  const list = Array.from(files as ArrayLike<File>);
  let name = '';
  const picked: PickedFile[] = [];
  for (const file of list) {
    const full = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const { root, rest } = splitRoot(full);
    if (name === '') name = root;
    picked.push({ file, relativePath: rest === '' ? file.name : rest });
  }
  return { name: name || 'Folder', files: picked };
}

/** The subset of the File and Directory Entries API a drop gives us. */
interface Entry {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly name: string;
  file?(success: (file: File) => void, failure: (error: unknown) => void): void;
  createReader?(): {
    readEntries(success: (entries: Entry[]) => void, failure: (error: unknown) => void): void;
  };
}

async function readAll(entry: Entry): Promise<Entry[]> {
  const reader = entry.createReader?.();
  if (reader === undefined) return [];
  const all: Entry[] = [];
  // `readEntries` returns at most ~100 entries per call; it must be called until it returns none.
  for (;;) {
    const batch = await new Promise<Entry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

async function walk(entry: Entry, prefix: string, out: PickedFile[]): Promise<void> {
  if (entry.isFile && entry.file !== undefined) {
    const file = await new Promise<File>((resolve, reject) => entry.file?.(resolve, reject));
    out.push({ file, relativePath: `${prefix}${entry.name}` });
    return;
  }
  if (entry.isDirectory) {
    for (const child of await readAll(entry)) await walk(child, `${prefix}${entry.name}/`, out);
  }
}

/** From a drop. Returns `null` when what was dropped is not a single folder. */
export async function folderFromDrop(items: DataTransferItemList): Promise<PickedFolder | null> {
  const entries: Entry[] = [];
  for (const item of Array.from(items)) {
    const entry = (
      item as DataTransferItem & { webkitGetAsEntry?: () => Entry | null }
    ).webkitGetAsEntry?.();
    if (entry !== null && entry !== undefined) entries.push(entry);
  }
  const [root] = entries;
  if (entries.length !== 1 || root === undefined || !root.isDirectory) return null;

  const files: PickedFile[] = [];
  for (const child of await readAll(root)) await walk(child, '', files);
  return { name: root.name, files };
}
