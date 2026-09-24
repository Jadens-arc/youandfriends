/**
 * Running ffmpeg and ffprobe against files a stranger uploaded.
 *
 * Every invocation in this package goes through here, so the safety properties are in one place
 * rather than repeated at each call site and forgotten at one of them.
 *
 * **Arguments are an array, never a string.** `execFile` hands the argument vector to the OS
 * directly; there is no shell to interpret it. A filename containing `; rm -rf ~` is then a
 * filename, which is the only thing it should ever be (`docs/THREAT_MODEL.md` T4, CLAUDE.md §9).
 * Nothing in this package may use `exec`, `spawn` with `shell: true`, or a template string
 * command.
 *
 * **A timeout is mandatory, and it kills rather than asks.** A malformed file must fail the job
 * cleanly rather than hang it. `execFile`'s timeout only *signals* at the deadline and settles on
 * the child's `close`, so with the default SIGTERM a child that defers the signal leaves the
 * promise pending forever and the process orphaned — and ffmpeg is exactly that kind of child:
 * its handler sets a flag checked at the next loop iteration, which a thread blocked inside a
 * demuxer read never reaches. Measured on a stub that traps SIGTERM: still pending after six
 * seconds against a 1.5s limit, versus 1505ms with `SIGKILL`. Probing has nothing to flush, so
 * there is no graceful shutdown worth waiting for.
 *
 * This also protects the scratch directory: an orphan holding unlinked files open means
 * `withTempWorkspace`'s cleanup reclaims no space.
 *
 * **Output is bounded.** `maxBuffer` caps what a process can return; ffprobe on a pathological
 * file can emit megabytes of stream metadata, and buffering it unbounded is how one upload
 * exhausts a worker's memory.
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Where the binaries live. Overridable, because a container image rarely uses the PATH name.
 *
 * **Read on every call, not captured at module load.** As constants these were fixed the moment
 * anything imported this file, which quietly made `YOUANDFRIENDS_FFMPEG_PATH` a documented
 * setting that only worked if the environment happened to be assembled before the first import.
 * It also made the startup capability gate untestable — there was no way to point it at an
 * inadequate build — and two tests in this package cited that as a reason to test a helper
 * instead of the thing that decides. A review caught the second one.
 */
export function ffprobePath(): string {
  return process.env.YOUANDFRIENDS_FFPROBE_PATH ?? 'ffprobe';
}

export function ffmpegPath(): string {
  return process.env.YOUANDFRIENDS_FFMPEG_PATH ?? 'ffmpeg';
}

/** Long enough for a large file on slow storage, short enough that a hang is noticed. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** 8 MiB. ffprobe JSON for a sane file is kilobytes; this is the hostile case. */
export const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export interface RunOptions {
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

/** A tool exited non-zero, timed out, or is not installed. */
export class ToolError extends Error {
  constructor(
    readonly tool: string,
    readonly reason: 'not_installed' | 'timed_out' | 'failed' | 'output_too_large',
    message: string,
    readonly stderr = '',
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

interface ExecFailure {
  code?: number | string;
  killed?: boolean;
  signal?: string;
  stderr?: string;
  message?: string;
}

/**
 * Run a tool and return its stdout.
 *
 * Failures are classified rather than rethrown raw, because the four cases need different
 * handling upstream: a missing binary is an environment fault that should stop the worker, a
 * timeout is this file's fault and the job fails, a non-zero exit is usually a corrupt input,
 * and oversized output is a hostile input.
 */
export async function run(
  tool: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<string> {
  return (await runForOutput(tool, args, options)).stdout;
}

/**
 * {@link run}, keeping stderr too. ffmpeg writes its analysis filters' reports — the `ebur128`
 * summary among them — to stderr, so a measurement has to read it. The same bounds apply to both
 * streams.
 */
export async function runForOutput(
  tool: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(tool, [...args], {
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      // No shell, explicitly. The default is already false; saying so makes the property
      // visible to anyone reading this call rather than implied by an absence.
      shell: false,
      // Not SIGTERM. See the note above: the default does not reap a child that defers it.
      killSignal: 'SIGKILL',
      windowsHide: true,
    });
    return { stdout, stderr };
  } catch (error) {
    const failure = error as ExecFailure;

    if (failure.code === 'ENOENT') {
      throw new ToolError(tool, 'not_installed', `${tool} is not installed or not on PATH`);
    }

    // `killed` with SIGTERM is how `execFile` reports its own timeout.
    if (failure.killed === true) {
      const limit = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      throw new ToolError(tool, 'timed_out', `${tool} did not finish within ${limit}ms`);
    }

    if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      throw new ToolError(tool, 'output_too_large', `${tool} produced more output than allowed`);
    }

    const stderr = (failure.stderr ?? '').trim();
    throw new ToolError(
      tool,
      'failed',
      `${tool} exited with ${String(failure.code ?? 'an error')}`,
      stderr,
    );
  }
}

/**
 * Run a tool and hand its stdout to `onData` as it arrives — for decoded audio, which is far too
 * large to buffer. The same safety as {@link run}: an argument array with no shell, a mandatory
 * timeout that kills with SIGKILL, and stderr bounded to what a diagnosis needs.
 */
export function runStreaming(
  tool: string,
  args: readonly string[],
  onData: (chunk: Buffer) => void,
  options: RunOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const stderrLimit = 64 * 1024;
  return new Promise((resolve, reject) => {
    const child = spawn(tool, [...args], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let settled = false;
    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error === null) resolve();
      else reject(error);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new ToolError(tool, 'timed_out', `${tool} did not finish within ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      try {
        onData(chunk);
      } catch (error) {
        child.kill('SIGKILL');
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < stderrLimit)
        stderr += chunk.toString('utf8').slice(0, stderrLimit - stderr.length);
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(
        error.code === 'ENOENT'
          ? new ToolError(tool, 'not_installed', `${tool} is not installed or not on PATH`)
          : error,
      );
    });
    child.on('close', (code) => {
      finish(
        code === 0
          ? null
          : new ToolError(tool, 'failed', `${tool} exited with ${String(code)}`, stderr.trim()),
      );
    });
  });
}
