import { memberSubject, type Subject } from '@youandfriends/authz';
import type { UserId } from '@youandfriends/contracts';

import { authDatabase, provisionUser, type ClerkIdentity } from './provision';

/**
 * Turning a Clerk session into something this product can authorize.
 *
 * One resolution per request. Clerk's `auth()` is cheap after the first call in a request, but
 * provisioning is a database write, and calling this twice in a render would do it twice — so
 * the result is cached for the life of the request by {@link resolveSession}'s caller.
 *
 * **Fails closed.** Every failure path here returns "no session" rather than throwing past the
 * caller or, worse, returning a partially-built subject. An error resolving identity is not a
 * reason to let a request through; it is a reason to treat it as anonymous and let the route
 * protection do its job (`docs/THREAT_MODEL.md`, task `030`).
 */

/** What a resolved request carries. `null` everywhere means: not signed in, or we could not tell. */
export interface ResolvedSession {
  readonly subject: Subject;
  readonly userId: string;
  readonly clerkUserId: string;
  /** True only on the request that created the `users` row. Drives the sign-in audit event. */
  readonly provisioned: boolean;
}

/**
 * Reads the Clerk identity for this request.
 *
 * Injected rather than imported so the resolution logic can be tested without a Clerk session,
 * a network, or a running Next server. The production reader is {@link clerkIdentityReader};
 * this is not a mock standing in for the integration (CLAUDE.md §7) — the real path is the
 * default and the seam exists for the tests around it.
 */
export type IdentityReader = () => Promise<ClerkIdentity | null>;

export interface ResolveOptions {
  readonly readIdentity: IdentityReader;
  readonly newId: () => string;
  /** Called when a resolution fails, so a swallowed error is still visible. */
  readonly onError?: ((error: unknown) => void) | undefined;
}

export async function resolveSession(options: ResolveOptions): Promise<ResolvedSession | null> {
  let identity: ClerkIdentity | null;

  try {
    identity = await options.readIdentity();
  } catch (error) {
    // Clerk unreachable, a malformed token, a clock skew — all of them mean we do not know who
    // this is, and "we do not know" is not "let them in".
    options.onError?.(error);
    return null;
  }

  if (identity === null) return null;

  // A Clerk session with no usable email is not a person we can create a row for. Treating it
  // as anonymous is the closed answer; inventing a placeholder email would put a fabricated
  // address in the audit log and on a future invitation.
  if (identity.email === '') {
    options.onError?.(new Error(`clerk user ${identity.clerkUserId} has no email address`));
    return null;
  }

  try {
    const { userId, created } = await provisionUser(authDatabase(), identity, options.newId);
    return {
      subject: memberSubject(userId as UserId),
      userId,
      clerkUserId: identity.clerkUserId,
      provisioned: created,
    };
  } catch (error) {
    // The database is unreachable or the write was refused. The person may well be signed in,
    // but without a `users` row there is no subject to authorize, and a subject we cannot build
    // is not one to guess at.
    options.onError?.(error);
    return null;
  }
}
