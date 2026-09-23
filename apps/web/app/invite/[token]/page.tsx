import { PRODUCT_NAME } from '@youandfriends/config';
import type { Metadata, Route } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { currentSession } from '@/lib/auth/current-session';
import { transactionalDatabase } from '@/lib/database';
import { acceptInvitationToken } from '@/lib/invitations/accept';
import { WORKSPACE_COOKIE } from '@/lib/workspace/resolve';

export const metadata: Metadata = { title: `Accept invitation · ${PRODUCT_NAME}` };

/**
 * Accepting an invitation from its link (task `032`).
 *
 * A sibling of `(workspace)`, deliberately: that layout resolves — and on a first sign-in,
 * provisions — a workspace before anything inside it renders, and acceptance has to happen
 * *first* (`tasks/032-memberships-and-invitations.md`, "order against provisioning"). Reaching
 * this page any other way means the workspace shell has already run; a fresh, empty,
 * provisioned workspace beside the one this invitation names is exactly the split that
 * ordering exists to avoid, and this route is what keeps acceptance ahead of it.
 *
 * `proxy.ts` already requires a session for every route this one is not on its public list —
 * `currentSession()` returning `null` here is the edge case where that has somehow stopped
 * being true between the proxy and this render, not the expected path.
 *
 * Never distinguishes "wrong token", "expired", "revoked", or "never existed" — one generic
 * message for all of them (`docs/THREAT_MODEL.md` T2; task `032`'s acceptance criteria). The
 * one exception is a verified, live invitation bound to a different address than the signed-in
 * person's: they have already proven they hold the token, so naming the mismatch tells them
 * nothing they could not see by comparing the email in their own inbox to the one they are
 * signed in as.
 */
export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await currentSession();
  if (session === null) redirect('/sign-in' as Route);

  const outcome = await acceptInvitationToken(
    { db: transactionalDatabase(), acceptingUserId: session.userId },
    token,
  );

  if (outcome.kind === 'accepted') {
    (await cookies()).set(WORKSPACE_COOKIE, outcome.workspaceId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
    redirect('/');
  }

  if (outcome.kind === 'wrong_email') {
    return (
      <Notice title="This invitation is for a different address">
        It was sent to {outcome.invitedEmail}, and you are signed in as someone else. Sign in as
        that address, or ask whoever invited you to send it to the one you are using now.
      </Notice>
    );
  }

  return (
    <Notice title="This invitation is no longer valid">
      It may have expired, already been used, or been withdrawn. Ask whoever invited you to send a
      new one.
    </Notice>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col gap-2 p-8 text-center">
      <h1 className="text-title text-foreground font-serif">{title}</h1>
      <p className="text-body text-muted-foreground font-sans">{children}</p>
    </div>
  );
}
