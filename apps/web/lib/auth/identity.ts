import type { ClerkIdentity } from './provision';

/**
 * Turning what Clerk knows about a person into the identity this product provisions from.
 *
 * Clerk describes a person in two shapes: the backend SDK's `User` (camelCase, from
 * `currentUser()` on a request) and the webhook's `UserJSON` (snake_case, from a session
 * event). Both paths provision the same `users` row, so the choice of email and display name is
 * made once, here — two derivations would eventually disagree, and the row would flip between
 * their answers depending on which path touched it last.
 */

/** The fields both shapes carry, normalized. */
export interface ClerkUserFields {
  readonly id: string;
  readonly primaryEmail: string | null;
  readonly emails: readonly string[];
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly username: string | null;
}

export function identityFrom(user: ClerkUserFields): ClerkIdentity {
  const email = user.primaryEmail ?? user.emails[0] ?? '';

  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(' ') ||
    user.username ||
    // Never the email: a display name is rendered beside comments and in presence, and
    // leaking an address there is a privacy regression nobody would notice shipping.
    'Someone';

  return { clerkUserId: user.id, email, displayName };
}
