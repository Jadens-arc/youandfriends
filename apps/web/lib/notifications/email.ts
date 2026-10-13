import { emailConfigFrom, parseServerEnv, type EmailConfig } from '@youandfriends/config';

/**
 * Whether email notifications can be sent from this deployment (task `096`). Read once per
 * process: it changes only with the environment.
 */
let config: EmailConfig | undefined;

export function emailConfig(): EmailConfig {
  config ??= emailConfigFrom(parseServerEnv());
  return config;
}
