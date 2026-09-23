import 'server-only';

import { cache } from 'react';
import { currentUser } from '@clerk/nextjs/server';
import { newUlid } from '@youandfriends/contracts';
import { loggerForEnv } from '@youandfriends/config';

import { identityFrom } from './identity';
import type { ClerkIdentity } from './provision';
import { resolveSession, type ResolvedSession } from './session';

/**
 * The session, for server components, server actions, and route handlers.
 *
 * `cache()` scopes the memo to one request, so a layout, a page, and three server components
 * resolving the session all share one Clerk read and one provisioning write. Without it a
 * render fan-out would re-provision per component — idempotently, but at the cost of a database
 * round trip each (task `030`: "do not call Clerk repeatedly within a request").
 */
export const currentSession = cache(async (): Promise<ResolvedSession | null> => {
  return resolveSession({
    readIdentity: clerkIdentityReader,
    newId: newUlid,
    onError: (error) => {
      // Never swallowed. A session that fails to resolve denies the request, and a denial
      // nobody can explain afterwards is the failure this log exists to prevent. The logger's
      // redaction (task `002`) keeps tokens out of it.
      loggerForEnv({ NODE_ENV: process.env.NODE_ENV ?? 'production' }).error(
        'session resolution failed',
        { error },
      );
    },
  });
});

/**
 * The real Clerk read.
 *
 * `currentUser()` rather than `auth()` because provisioning needs the email and name, and
 * `auth()` carries only ids. Clerk caches it per request, so the extra field access is not an
 * extra round trip.
 */
export async function clerkIdentityReader(): Promise<ClerkIdentity | null> {
  const user = await currentUser();
  if (user === null) return null;

  return identityFrom({
    id: user.id,
    primaryEmail: user.primaryEmailAddress?.emailAddress ?? null,
    emails: user.emailAddresses.map((address) => address.emailAddress),
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
  });
}
