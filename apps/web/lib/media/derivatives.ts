import 'server-only';

import { parseServerEnv } from '@youandfriends/config';
import { createR2Driver, r2ConfigFrom, type StorageDriver } from '@youandfriends/storage';

let derivatives: StorageDriver | null = null;

/**
 * The derivatives bucket's driver, memoized per warm instance. Throws `StorageNotConfiguredError`
 * naming what is missing when R2 is not configured — the stream route answers 503 for it.
 */
export function derivativesDriver(): StorageDriver {
  derivatives ??= createR2Driver(r2ConfigFrom(parseServerEnv(), 'derivatives'));
  return derivatives;
}
