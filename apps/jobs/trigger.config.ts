import { ffmpeg } from '@trigger.dev/build/extensions/core';
import { defineConfig } from '@trigger.dev/sdk';

/**
 * Trigger.dev project configuration (ADR 0002).
 *
 * `ffmpeg()` installs a real ffmpeg in the deploy image; the capability probe (task `060`) checks
 * at each job's start that it has the encoders and filters the pipeline needs, and fails loudly
 * if not. `TRIGGER_PROJECT_ID` names the project — an identifier, not a credential; the secret
 * key is read by the CLI from the environment and never appears here.
 */
const project = process.env.TRIGGER_PROJECT_ID;
if (project === undefined || project === '') {
  throw new Error('TRIGGER_PROJECT_ID is not set — see the Trigger.dev section of .env.example');
}

export default defineConfig({
  project,
  runtime: 'node',
  dirs: ['./src/trigger'],
  maxDuration: 3600,
  build: {
    extensions: [ffmpeg({ version: '7' })],
  },
});
