import { CLIENT_ZIP_MAX_FILES } from '@youandfriends/contracts';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { folderFromDrop, folderFromFileList, type PickedFolder } from '../folder';
import { buildManifest, reviewFolder } from '../manifest';
import { readSlice } from '../hash';
import { zipFolder } from '../zip';

import { bytesOf } from './harness';

function fileAt(path: string, size = 16, lastModified = 1_700_000_000_000): File {
  const file = new File([bytesOf(size)], path.split('/').at(-1) ?? path, { lastModified });
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

function picked(paths: readonly string[]): PickedFolder {
  return folderFromFileList(paths.map((path) => fileAt(`Session/${path}`)));
}

describe('folderFromFileList', () => {
  it('names the snapshot after the chosen folder and roots paths inside it', () => {
    const folder = folderFromFileList([
      fileAt('Night Drive/Audio Files/Kick.wav'),
      fileAt('Night Drive/Night Drive.logicx/Resources/x.plist'),
    ]);
    expect(folder.name).toBe('Night Drive');
    expect(folder.files.map((file) => file.relativePath)).toEqual([
      'Audio Files/Kick.wav',
      'Night Drive.logicx/Resources/x.plist',
    ]);
  });
});

describe('folderFromDrop', () => {
  /** A fake directory tree in the File and Directory Entries API's shape, batching like Chrome. */
  function directory(name: string, children: unknown[]) {
    return {
      isFile: false,
      isDirectory: true,
      name,
      createReader() {
        let offset = 0;
        return {
          readEntries(success: (entries: unknown[]) => void) {
            const batch = children.slice(offset, offset + 2);
            offset += 2;
            success(batch);
          },
        };
      },
    };
  }
  function fileEntry(name: string) {
    return {
      isFile: true,
      isDirectory: false,
      name,
      file: (success: (file: File) => void) => success(new File(['x'], name)),
    };
  }

  it('walks every level, reading each directory until it is exhausted', async () => {
    const tree = directory('Session', [
      fileEntry('a.wav'),
      fileEntry('b.wav'),
      fileEntry('c.wav'),
      directory('Stems', [fileEntry('bass.wav')]),
    ]);
    const items = [{ webkitGetAsEntry: () => tree }] as unknown as DataTransferItemList;
    const folder = await folderFromDrop(items);
    expect(folder?.name).toBe('Session');
    expect(folder?.files.map((file) => file.relativePath)).toEqual([
      'a.wav',
      'b.wav',
      'c.wav',
      'Stems/bass.wav',
    ]);
  });

  it('declines anything that is not exactly one folder', async () => {
    const one = [{ webkitGetAsEntry: () => fileEntry('a.wav') }] as unknown as DataTransferItemList;
    expect(await folderFromDrop(one)).toBeNull();
  });
});

describe('reviewFolder', () => {
  it('includes, ignores with a reason, and excludes unsafe paths with a reason', () => {
    const review = reviewFolder({
      name: 'Session',
      files: [
        { file: fileAt('x/Kick.wav', 100), relativePath: 'Audio Files/Kick.wav' },
        { file: fileAt('x/.DS_Store'), relativePath: 'Audio Files/.DS_Store' },
        { file: fileAt('x/Undo.lock'), relativePath: 'Undo.lock' },
        { file: fileAt('x/evil.wav'), relativePath: '../evil.wav' },
        { file: fileAt('x/Café.wav'), relativePath: 'Café.wav' },
        { file: fileAt('x/dup.wav'), relativePath: 'Audio Files//Kick.wav' },
      ],
    });
    const byPath = Object.fromEntries(
      review.files.map((file) => [file.source.relativePath, [file.status, file.reason]]),
    );
    expect(byPath['Audio Files/Kick.wav']).toEqual(['included', null]);
    expect(byPath['Audio Files/.DS_Store']?.[0]).toBe('ignored');
    expect(byPath['Audio Files/.DS_Store']?.[1]).toMatch(/macOS/);
    expect(byPath['Undo.lock']?.[0]).toBe('ignored');
    expect(byPath['../evil.wav']).toEqual(['excluded', 'It points outside the folder.']);
    expect(byPath['Café.wav']?.[0]).toBe('excluded');
    expect(byPath['Audio Files//Kick.wav']).toEqual([
      'excluded',
      'Another file has the same path.',
    ]);
    expect(review).toMatchObject({ includedCount: 1, includedBytes: 100, zipInBrowser: true });
  });

  it('applies the person’s own patterns', () => {
    const review = reviewFolder(picked(['Bounces/old.wav', 'Keep.wav']), [
      { id: 'mine', pattern: 'Bounces/**', reason: 'Bounces are rebuilt.' },
    ]);
    expect(review.files.map((file) => file.status)).toEqual(['ignored', 'included']);
  });

  it('recommends the Mac app instead of zipping a folder over the ceiling', () => {
    const many = picked(
      Array.from({ length: CLIENT_ZIP_MAX_FILES + 1 }, (_, index) => `f${index}.wav`),
    );
    expect(reviewFolder(many).zipInBrowser).toBe(false);
    expect(reviewFolder(picked(['.DS_Store'])).zipInBrowser).toBe(false);
  });
});

describe('buildManifest', () => {
  it('records path, size, mtime, a checksum for included files, and the reason for ignored ones', async () => {
    const review = reviewFolder(picked(['a.wav', '.DS_Store', '../x.wav']));
    const hashed: string[] = [];
    const entries = await buildManifest(review, async (file) => {
      hashed.push(file.name);
      return 'b'.repeat(64);
    });
    expect(hashed).toEqual(['a.wav']);
    expect(entries).toEqual([
      {
        path: 'a.wav',
        sizeBytes: 16,
        modifiedAt: new Date(1_700_000_000_000).toISOString(),
        checksumSha256: 'b'.repeat(64),
        ignored: false,
        ignoreReason: null,
      },
      expect.objectContaining({ path: '.DS_Store', ignored: true, checksumSha256: null }),
    ]);
    expect(entries[1]?.ignoreReason).toMatch(/macOS/);
  });
});

describe('zipFolder', () => {
  it('stores only the included files, under their normalized paths, byte for byte', async () => {
    const review = reviewFolder(picked(['Audio/a.wav', 'Audio/.DS_Store', 'b.wav']));
    const zip = await zipFolder(review);
    const bytes = new Uint8Array(await readSlice(zip));
    const contents = unzipSync(bytes);
    expect(Object.keys(contents).sort()).toEqual(['Audio/a.wav', 'b.wav']);
    expect(contents['b.wav']).toEqual(bytesOf(16));
  });
});
