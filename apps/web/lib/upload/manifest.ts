import {
  CLIENT_ZIP_MAX_BYTES,
  CLIENT_ZIP_MAX_FILES,
  DEFAULT_IGNORE_RULES,
  matchIgnoreRule,
  normalizeRelativePath,
  PATH_REJECTION_REASONS,
  type IgnoreRule,
  type ManifestEntry,
} from '@youandfriends/contracts';

import type { HashProgress } from './checksum';
import type { PickedFile, PickedFolder } from './folder';

/**
 * The manifest (task `054`): every file in the folder, with its path, size, mtime, checksum, and —
 * for anything left out — the reason, shown to the person before a byte is sent.
 *
 * Two kinds of "left out", both recorded and both explained:
 *   - **ignored** by a rule (`.DS_Store`, lock files, partial renders, the person's own patterns);
 *   - **excluded** because its path cannot be stored safely — a traversal, or characters the
 *     path rule does not accept. These are listed in the review but cannot be recorded
 *     server-side, because the server applies the same rule.
 */

export interface ReviewedFile {
  readonly source: PickedFile;
  /** The normalized path, or `null` when the path itself was rejected. */
  readonly path: string | null;
  readonly status: 'included' | 'ignored' | 'excluded';
  /** A sentence for anything not included. */
  readonly reason: string | null;
}

export interface FolderReview {
  readonly name: string;
  readonly files: readonly ReviewedFile[];
  readonly includedBytes: number;
  readonly includedCount: number;
  /** Whether the browser should zip this, or recommend the Mac agent instead. */
  readonly zipInBrowser: boolean;
}

export function reviewFolder(
  folder: PickedFolder,
  rules: readonly IgnoreRule[] = DEFAULT_IGNORE_RULES,
): FolderReview {
  const seen = new Set<string>();
  const files: ReviewedFile[] = folder.files.map((source) => {
    const normalized = normalizeRelativePath(source.relativePath);
    if (!normalized.ok) {
      return {
        source,
        path: null,
        status: 'excluded',
        reason: PATH_REJECTION_REASONS[normalized.reason],
      };
    }
    if (seen.has(normalized.path)) {
      return { source, path: null, status: 'excluded', reason: 'Another file has the same path.' };
    }
    seen.add(normalized.path);
    const rule = matchIgnoreRule(normalized.path, rules);
    return rule === null
      ? { source, path: normalized.path, status: 'included', reason: null }
      : { source, path: normalized.path, status: 'ignored', reason: rule.reason };
  });

  const included = files.filter((file) => file.status === 'included');
  const includedBytes = included.reduce((sum, file) => sum + file.source.file.size, 0);
  return {
    name: folder.name,
    files,
    includedBytes,
    includedCount: included.length,
    zipInBrowser:
      included.length > 0 &&
      includedBytes <= CLIENT_ZIP_MAX_BYTES &&
      included.length <= CLIENT_ZIP_MAX_FILES,
  };
}

/**
 * The manifest entries the server records: included files with a checksum, ignored files with
 * their reason. Excluded files are not sent — the server would refuse the path, which is the
 * point of the rule.
 */
export async function buildManifest(
  review: FolderReview,
  hash: (file: File, onProgress: HashProgress) => Promise<string>,
  onProgress: (hashedBytes: number) => void = () => {},
): Promise<ManifestEntry[]> {
  const entries: ManifestEntry[] = [];
  let done = 0;
  for (const file of review.files) {
    if (file.path === null || file.status === 'excluded') continue;
    const { size, lastModified } = file.source.file;
    const checksum =
      file.status === 'included'
        ? await hash(file.source.file, (bytes) => onProgress(done + bytes))
        : null;
    if (file.status === 'included') done += size;
    entries.push({
      path: file.path,
      sizeBytes: size,
      modifiedAt:
        Number.isFinite(lastModified) && lastModified > 0
          ? new Date(lastModified).toISOString()
          : null,
      checksumSha256: checksum,
      ignored: file.status === 'ignored',
      ignoreReason: file.reason,
    });
  }
  return entries;
}
