import { SignUp } from '@clerk/nextjs';
import type { Metadata } from 'next';

import { PRODUCT_NAME } from '@youandfriends/config';

import { clerkAppearance } from '@/lib/auth/appearance';

export const metadata: Metadata = { title: `Sign up · ${PRODUCT_NAME}` };

/**
 * Present, but not a public door.
 *
 * Iteration one is invitation-only (task `030` non-scope; public sign-up is deferred `209`), so
 * this exists to complete an invitation rather than to accept strangers. Clerk enforces that
 * through its own restriction settings — the route being reachable is not the same as sign-up
 * being open, and this page must not be read as the latter.
 */
export default function SignUpPage() {
  return <SignUp appearance={clerkAppearance} />;
}
