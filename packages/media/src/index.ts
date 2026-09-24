/**
 * `@youandfriends/media`
 *
 * ffprobe validation, loudness analysis, derivative recipes, waveform peaks, and job contracts.
 *
 * **ffmpeg and ffprobe are prerequisites of this package**, not optional extras. Everything below
 * except `sniff` shells out to them, and {@link assertCapabilities} exists so a worker whose build
 * lacks a required encoder refuses to start rather than producing derivatives that are silently
 * broken (ADR 0002, ADR 0004). See `README.md` for installation.
 *
 * Magic-byte content typing landed early, in task `051`, because finalize cannot record a content
 * type without it and finalize is not a place to trust the client. Loudness (`061`), transcoding
 * (`062`) and waveforms (`063`) build on the probe and dispatcher here.
 */

export {
  hintDisagrees,
  sniffableContentTypes,
  sniffContentType,
  SNIFF_PREFIX_BYTES,
  UNKNOWN_CONTENT_TYPE,
} from './sniff';

export {
  assertCapabilities,
  capabilitiesFrom,
  meetsMinimum,
  MINIMUM_FFMPEG_VERSION,
  parseToolVersion,
  MissingCapabilityError,
  parseNames,
  probeCapabilities,
  AAC_ENCODERS,
  REQUIRED_ENCODERS,
  REQUIRED_FILTERS,
  type Capabilities,
} from './capabilities';

export {
  AUDIO_TASK_ID,
  DispatchError,
  InlineDispatcher,
  TriggerDispatcher,
  type InlineRunner,
  type JobDispatcher,
  type TriggerClient,
} from './dispatcher';

export {
  FINE_BUCKETS_PER_SECOND,
  generateWaveformPeaks,
  MEDIUM_BUCKETS_PER_SECOND,
  mergeBuckets,
  OVERVIEW_BUCKETS,
  PeakAccumulator,
  WAVEFORM_TIMEOUT_MS,
} from './waveform';

export {
  DEFAULT_STREAM_BITRATE,
  DERIVATIVE_CONTENT_TYPE,
  STREAM_CHANNELS,
  STREAM_SAMPLE_RATE_HZ,
  topLevelBoxes,
  transcodeArgs,
  transcodeStreamingDerivative,
  TRANSCODE_TIMEOUT_MS,
  variantOf,
  type DerivativeRecipe,
} from './derivative';

export {
  ABSOLUTE_GATE_LUFS,
  LOUDNESS_TIMEOUT_MS,
  measureLoudness,
  MIN_MEASURABLE_MS,
  parseEbur128Summary,
  type LoudnessResult,
  type LoudnessUnavailable,
} from './loudness';

export { NotAudioError, probeAudio, ffprobeOutputSchema, type AudioProbe } from './probe';

export {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  ffmpegPath,
  ffprobePath,
  runForOutput,
  runStreaming,
  ToolError,
  untrustedInput,
  type RunOptions,
} from './run';

export {
  audioJobInputSchema,
  audioOperationSchema,
  jobStatusSchema,
  probeResultSchema,
  type AudioJobInput,
  type AudioOperation,
  type JobHandle,
  type JobStatus,
  type ProbeResult,
} from './types';

export {
  MAX_DURATION_MS,
  validateAudio,
  type ValidateOptions,
  type ValidationFailure,
  type ValidationResult,
} from './validate';

export {
  DEFAULT_TEMP_BUDGET_BYTES,
  TempBudgetExceededError,
  withTempWorkspace,
  type TempWorkspace,
} from './workspace';

/** Package identifier, used to confirm the workspace graph resolves correctly. */
export const PACKAGE_NAME = '@youandfriends/media' as const;
