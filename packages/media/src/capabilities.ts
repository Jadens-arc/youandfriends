/**
 * Does this ffmpeg build have what the pipeline needs?
 *
 * **This is the mitigation ADR 0002 and ADR 0004 both name.** ffmpeg is not one program; it is a
 * build, and builds differ in which encoders were compiled in. A distribution package without
 * `libopus`, or one built `--disable-encoder=aac`, runs every command we issue and reports
 * success at the container level while producing a derivative that is silent, empty, or missing.
 * Nobody notices until someone presses play on a song they cannot re-render, because the original
 * is sacred and the derivative was the only thing that changed.
 *
 * So the probe **fails loudly at startup**, before any job runs. A worker that cannot do the work
 * should refuse to start rather than consume a queue and quietly ruin it.
 */
import { ffmpegPath, ffprobePath, run, ToolError, type RunOptions } from './run';

/**
 * What a worker must have before it may take a job.
 *
 * `libopus` is here even though ADR 0004 chose AAC for iteration one and deferred Opus to task
 * `205`. That is deliberate, not a leftover: the decision to defer Opus was about which
 * derivative we *produce*, and a build lacking libopus cannot be upgraded to produce one later
 * without a new image. Requiring it now means the day task `205` lands, every running worker can
 * already do the work. Removing it from this list because "we do not use Opus yet" would be
 * exactly the change that makes `205` a deployment problem instead of a code change.
 */
export const REQUIRED_ENCODERS = ['libopus'] as const;

/**
 * Any one of these satisfies "a usable AAC encoder".
 *
 * ADR 0004 records the requirement as "`aac` native, **or `libfdk_aac`**", and this gate used to
 * demand the exact name `aac` — stricter than the decision it cites, and with a test enshrining
 * the refusal. A build configured `--enable-libfdk-aac --disable-encoder=aac` is an ordinary
 * distribution choice, and every worker on such an image would have exited at startup for a
 * build the ADR blesses. Found in review.
 *
 * Order is preference: native `aac` first, because it is always redistributable and needs no
 * licence consideration. {@link Capabilities.aacEncoder} reports which one was found, so the
 * transcode recipe in task `062` names what exists rather than assuming.
 */
export const AAC_ENCODERS = ['aac', 'libfdk_aac'] as const;

/** `ebur128` is how loudness is measured (task `061`). Without it there is no LUFS value. */
export const REQUIRED_FILTERS = ['ebur128'] as const;

/**
 * The oldest ffmpeg this worker accepts (task `068`, `docs/THREAT_MODEL.md` T12). 6.1 is the
 * release the pipeline was built and reviewed against: its refusal of non-`file` protocols inside
 * a `file:` input, its `ebur128` summary format, and its fMP4 muxer flags are what the rest of
 * this package relies on. Older builds also carry published demuxer CVEs. A version is a control
 * only because it is checked, here, at every job's start.
 */
export const MINIMUM_FFMPEG_VERSION = [6, 1] as const;

/**
 * `ffmpeg version 6.1.1-3ubuntu5 Copyright…` → `[6, 1, 1]`; `ffmpeg version n7.0.2` → `[7, 0, 2]`.
 * A git snapshot (`ffmpeg version N-113348-g…`) has no release number and parses to `null` —
 * refused, because "some commit" cannot be compared against a floor.
 */
export function parseToolVersion(versionOutput: string): readonly number[] | null {
  const firstLine = versionOutput.split('\n')[0] ?? '';
  const match = firstLine.match(/^\S+ version n?(\d+)\.(\d+)(?:\.(\d+))?/);
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

export function meetsMinimum(version: readonly number[] | null): boolean {
  if (version === null) return false;
  const [major = 0, minor = 0] = version;
  const [minMajor, minMinor] = MINIMUM_FFMPEG_VERSION;
  return major > minMajor || (major === minMajor && minor >= minMinor);
}

export interface Capabilities {
  /** ffmpeg's and ffprobe's release numbers, or `null` when they could not be read. */
  readonly ffmpegVersion: readonly number[] | null;
  readonly ffprobeVersion: readonly number[] | null;
  /** Whether both are at or above {@link MINIMUM_FFMPEG_VERSION}. */
  readonly versionOk: boolean;
  readonly encoders: readonly string[];
  readonly filters: readonly string[];
  readonly missingEncoders: readonly string[];
  readonly missingFilters: readonly string[];
  /** The AAC encoder this build actually has, or `null`. Task `062`'s recipe reads this. */
  readonly aacEncoder: (typeof AAC_ENCODERS)[number] | null;
  readonly ok: boolean;
}

/** The environment cannot do the work. Thrown at startup, never swallowed. */
export class MissingCapabilityError extends Error {
  constructor(readonly capabilities: Capabilities) {
    const missing = [
      ...capabilities.missingEncoders.map((name) => `encoder ${name}`),
      ...capabilities.missingFilters.map((name) => `filter ${name}`),
      ...(capabilities.versionOk
        ? []
        : [
            `version ${MINIMUM_FFMPEG_VERSION.join('.')} or later (found ffmpeg ${
              capabilities.ffmpegVersion?.join('.') ?? 'unknown'
            }, ffprobe ${capabilities.ffprobeVersion?.join('.') ?? 'unknown'})`,
          ]),
    ];
    super(
      `this ffmpeg build is missing ${missing.join(', ')} — ` +
        'it would produce silently broken derivatives, so this worker will not start',
    );
    this.name = 'MissingCapabilityError';
  }
}

/**
 * Names from an `ffmpeg -encoders` or `-filters` listing.
 *
 * Both print a header, a `------` rule, then rows whose **second** whitespace-separated field is
 * the name:
 *
 *     A....D aac                  AAC (Advanced Audio Coding)
 *     ... ebur128           A->N       EBU R128 scanner.
 *
 * Taking the field rather than searching the text is the whole correctness question here. A
 * substring search for `aac` matches `libfdk_aac`, `aac_at` and the *description* of half a dozen
 * others, so a build with no usable AAC encoder would pass. The same search for `opus` matches
 * the `opus` decoder on a build whose `libopus` encoder is absent.
 */
export function parseNames(listing: string): string[] {
  const names: string[] = [];
  for (const line of listing.split('\n')) {
    // Rows are indented under a flags column; headers and the rule are not useful.
    const match = /^\s*[A-Z.]{3,6}\s+(\S+)/.exec(line);
    const name = match?.[1];
    if (name === undefined || name === '=' || name.startsWith('-')) continue;
    names.push(name);
  }
  return names;
}

/**
 * Decide, from two listings, whether this build is usable.
 *
 * Separate from the invocation so it can be tested against a build we do not have. That matters
 * more than it sounds: the interesting case is a build with `libfdk_aac` and no `aac`, and the
 * only ffmpeg available to a test is whichever one is installed. With the decision inlined into
 * `probeCapabilities`, replacing the exact-name check with a substring search over the raw
 * listing passed every test — because the installed build happens to have the exact names.
 *
 * Every comparison is against a **parsed name**, never the listing text.
 */
export function capabilitiesFrom(
  encoderListing: string,
  filterListing: string,
  versions: { readonly ffmpeg: string; readonly ffprobe: string } = { ffmpeg: '', ffprobe: '' },
): Capabilities {
  const ffmpegVersion = parseToolVersion(versions.ffmpeg);
  const ffprobeVersion = parseToolVersion(versions.ffprobe);
  const versionOk = meetsMinimum(ffmpegVersion) && meetsMinimum(ffprobeVersion);
  const encoders = parseNames(encoderListing);
  const filters = parseNames(filterListing);

  const aacEncoder = AAC_ENCODERS.find((name) => encoders.includes(name)) ?? null;

  const missingEncoders = [
    ...REQUIRED_ENCODERS.filter((name) => !encoders.includes(name)),
    // Reported as the requirement rather than as one name, so the message tells an operator what
    // would satisfy it instead of naming an encoder they may have deliberately not built.
    ...(aacEncoder === null ? [`an AAC encoder (one of ${AAC_ENCODERS.join(', ')})`] : []),
  ];
  const missingFilters = REQUIRED_FILTERS.filter((name) => !filters.includes(name));

  return {
    ffmpegVersion,
    ffprobeVersion,
    versionOk,
    encoders,
    filters,
    missingEncoders,
    missingFilters,
    aacEncoder,
    ok: versionOk && missingEncoders.length === 0 && missingFilters.length === 0,
  };
}

/** Ask the binary what it can do. */
export async function probeCapabilities(options: RunOptions = {}): Promise<Capabilities> {
  // **Both binaries.** The gate used to execute only ffmpeg, so a worker with a good ffmpeg and
  // a mis-pointed `YOUANDFRIENDS_FFPROBE_PATH` started, consumed the queue, and failed every job
  // at run time — precisely the posture this file exists to prevent. ffprobe needs no capability
  // check, only proof that it is there and runnable.
  const [encoderListing, filterListing, ffmpeg, ffprobe] = await Promise.all([
    run(ffmpegPath(), ['-hide_banner', '-encoders'], options),
    run(ffmpegPath(), ['-hide_banner', '-filters'], options),
    run(ffmpegPath(), ['-version'], options),
    run(ffprobePath(), ['-version'], options),
  ]);

  return capabilitiesFrom(encoderListing, filterListing, { ffmpeg, ffprobe });
}

/**
 * Refuse to continue unless the build is usable.
 *
 * Call this at worker startup. It throws `MissingCapabilityError` for a build that is present but
 * inadequate, and `ToolError` with reason `not_installed` when there is no ffmpeg at all — two
 * different operational problems that deserve two different messages at 3am.
 */
export async function assertCapabilities(options: RunOptions = {}): Promise<Capabilities> {
  let capabilities: Capabilities;
  try {
    capabilities = await probeCapabilities(options);
  } catch (error) {
    if (error instanceof ToolError && error.reason === 'not_installed') {
      throw new ToolError(
        error.tool,
        'not_installed',
        `${error.tool} is not installed — this worker cannot process audio and will not start`,
      );
    }
    throw error;
  }

  if (!capabilities.ok) throw new MissingCapabilityError(capabilities);
  return capabilities;
}
