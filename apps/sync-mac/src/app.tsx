import * as React from 'react';

import { loadStatus, type AgentStatus } from './status';

/**
 * The agent's window (task `111`): what it is doing, in words. Pairing, destinations, and the
 * activity log arrive with task `116`; until then, this says exactly what is true.
 */
export function App({ load = loadStatus }: { readonly load?: typeof loadStatus }) {
  const [status, setStatus] = React.useState<AgentStatus | null | 'loading'>('loading');

  React.useEffect(() => {
    let cancelled = false;
    void load().then((loaded) => {
      if (!cancelled) setStatus(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  return (
    <main className="flex min-h-dvh flex-col gap-3 p-4">
      <h1 className="text-ink font-serif text-xl">You &amp; Friends Sync</h1>
      <p role="status" className="text-ink text-sm">
        {status === 'loading'
          ? 'Checking…'
          : status === null
            ? 'The agent’s status is unavailable. Quit and reopen the app.'
            : status.summary}
      </p>
      {status !== 'loading' && status !== null ? (
        <p className="text-secondary text-xs">Version {status.version}</p>
      ) : null}
    </main>
  );
}
