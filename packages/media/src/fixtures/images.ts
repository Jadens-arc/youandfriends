import { join } from 'node:path';

import { ffmpegPath, run } from '../run';

/**
 * A generated test picture (task `069`) — ffmpeg's `testsrc` pattern, never someone's artwork.
 * For tests in other packages that need an artwork original on disk.
 */
export async function writeTestImage(
  dir: string,
  name: string,
  spec: {
    readonly width: number;
    readonly height: number;
    readonly codec?: 'mjpeg' | 'png' | 'libwebp';
  },
): Promise<string> {
  const path = join(dir, name);
  await run(
    ffmpegPath(),
    [
      '-hide_banner',
      '-nostdin',
      '-v',
      'error',
      '-n',
      '-f',
      'lavfi',
      '-i',
      `testsrc=size=${spec.width}x${spec.height}`,
      '-frames:v',
      '1',
      ...(spec.codec === undefined ? [] : ['-c:v', spec.codec]),
      path,
    ],
    { timeoutMs: 60_000 },
  );
  return path;
}
