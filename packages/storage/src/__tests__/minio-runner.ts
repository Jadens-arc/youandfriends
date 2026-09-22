import { spawnSync } from 'node:child_process';

import {
  managedMinioEnvironment,
  REPOSITORY_ROOT,
  startMinioService,
  stopMinioService,
} from './minio-harness';

let status = 1;
try {
  startMinioService();
  const result = spawnSync('pnpm', ['--filter', '@youandfriends/storage', 'test:contract'], {
    cwd: REPOSITORY_ROOT,
    // Managed runs always test the service this runner started. Caller-provided endpoint or
    // credential overrides must not redirect the suite and turn a skip into a passing gate.
    env: managedMinioEnvironment(),
    stdio: 'inherit',
  });
  status = result.status ?? 1;
} finally {
  try {
    stopMinioService();
  } catch (error) {
    console.error('Failed to stop the MinIO contract-test service:', error);
    status = 1;
  }
}

process.exit(status);
