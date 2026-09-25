/**
 * `@youandfriends/media/testing` — what other workspaces' tests need to run real media work:
 * generated tones (never user music, CLAUDE.md §8) and the loud-skip prerequisite check.
 */
export { generateWav, type ToneSpec } from '../fixtures/tone';
export { announceSkip, unavailableReason } from './prerequisite';
export {
  expectedLufs,
  MEDIA_FIXTURES,
  writeFixture,
  type FixtureContainer,
  type MediaFixture,
} from '../fixtures/catalog';
export { writeTestImage } from '../fixtures/images';
