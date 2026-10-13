import type { Route } from 'next';
import { redirect } from 'next/navigation';

import { AFTER_SIGN_IN_PATH } from '@/lib/auth/routes';

/**
 * The front door. Everything lives in the workspace, so the root sends a signed-in person to
 * their library; a signed-out one never gets this far — the proxy sends them to sign in first.
 */
export default function Home(): never {
  redirect(AFTER_SIGN_IN_PATH as Route);
}
