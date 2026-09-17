import { SignIn } from '@clerk/nextjs';
import type { Metadata } from 'next';

import { PRODUCT_NAME } from '@youandfriends/config';

import { clerkAppearance } from '@/lib/auth/appearance';

export const metadata: Metadata = { title: `Sign in · ${PRODUCT_NAME}` };

/**
 * Catch-all (`[[...sign-in]]`) because Clerk routes its own steps underneath this path —
 * factor-one, factor-two, reset. A single `page.tsx` would 404 on the second step of any flow
 * that has one.
 */
export default function SignInPage() {
  return <SignIn appearance={clerkAppearance} />;
}
