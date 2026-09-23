import { currentWorkspace } from '@/lib/workspace/current';

/**
 * Resolves — and on a first sign-in, provisions — the workspace before any page renders.
 *
 * This is what makes the owner's workspace exist "from the first moment" (task `031`): the
 * first authenticated render is the first moment, and it passes through here whichever page it
 * lands on. The resolution is cached for the request, so the page asking again costs nothing.
 *
 * When it cannot resolve — the database unreachable, provisioning refused — the pages are not
 * rendered at all, rather than rendered with nothing behind them. The message says what is
 * wrong without saying why, because why is in the server log and not the visitor's business.
 */
export async function WorkspaceGate({ children }: { children: React.ReactNode }) {
  const context = await currentWorkspace();
  if (context !== null) return children;
  return <WorkspaceUnavailable />;
}

export function WorkspaceUnavailable() {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col gap-2 p-8 text-center">
      <h1 className="text-title text-foreground font-serif">Your workspace isn’t available</h1>
      <p className="text-body text-muted-foreground font-sans">
        It couldn’t be loaded just now. Nothing in it has changed. Try again in a moment.
      </p>
    </div>
  );
}
