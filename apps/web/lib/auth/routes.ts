/**
 * Where signing in happens, and where it lands (task `030`).
 *
 * The app's own pages, never Clerk's hosted Account Portal. Signing in on the portal, a sibling
 * subdomain, leaves the session in cookies the app's domain must then receive from Clerk's
 * frontend API; when they do not arrive, `auth.protect()` sees a signed-out visitor, sends them
 * to the portal, the portal sees them signed in and sends them back — a redirect loop. Signing
 * in here sets the session first-party, on the domain the proxy reads it from.
 */
export const SIGN_IN_PATH = '/sign-in';
export const SIGN_UP_PATH = '/sign-up';
/** Where a fresh sign-in lands when it was not sent from somewhere in particular. */
export const AFTER_SIGN_IN_PATH = '/library';
