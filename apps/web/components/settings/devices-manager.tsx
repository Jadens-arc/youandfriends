'use client';

import { Button, cn, focusRing } from '@youandfriends/ui';
import { Copy, Laptop } from 'lucide-react';
import * as React from 'react';

/**
 * Pairing and disconnecting Mac sync devices (task `110`).
 *
 * The token is shown **once**, right after pairing, with a copy button and a plain statement that
 * it will not be shown again. It lives only in this component's state; leaving the page drops it.
 * Disconnecting takes effect on the device's next request.
 */

interface Device {
  readonly id: string;
  readonly name: string;
  readonly pairedBy: string | null;
  readonly mine: boolean;
  readonly lastUsedAt: string | null;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly destinations: readonly { readonly projectId: string; readonly name: string }[];
}

interface Project {
  readonly id: string;
  readonly name: string;
}

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function DevicesManager() {
  const [devices, setDevices] = React.useState<readonly Device[] | 'loading' | 'error'>('loading');
  const [projects, setProjects] = React.useState<readonly Project[]>([]);
  const [pairing, setPairing] = React.useState(false);
  const [issued, setIssued] = React.useState<{ name: string; token: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // When the page opened: whether a device has expired is judged against it, not re-read on render.
  const [openedAt] = React.useState(() => Date.now());

  const load = React.useCallback(async () => {
    const response = await fetch('/api/sync/devices', { cache: 'no-store' }).catch(() => null);
    const body = response?.ok === true ? ((await response.json()) as { devices?: unknown }) : null;
    setDevices(Array.isArray(body?.devices) ? (body.devices as Device[]) : 'error');
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    void fetch('/api/uploads/destinations', { cache: 'no-store' })
      .then(async (response) =>
        response.ok
          ? ((await response.json()) as {
              destinations: { type: string; id: string; name: string }[];
            })
          : null,
      )
      .catch(() => null)
      .then((body) => {
        if (cancelled || body === null) return;
        setProjects(
          body.destinations
            .filter((destination) => destination.type === 'project')
            .map((destination) => ({ id: destination.id, name: destination.name })),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function pair(form: HTMLFormElement) {
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    const projectIds = data.getAll('project').map(String);
    const expires = String(data.get('expires') ?? '90');
    setError(null);
    if (name === '' || projectIds.length === 0) {
      setError('Name the device and choose at least one project.');
      return;
    }
    const response = await fetch('/api/sync/devices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        projectIds,
        expiresInDays: expires === 'never' ? null : Number(expires),
      }),
    }).catch(() => null);
    if (response?.ok !== true) {
      setError('The device couldn’t be paired. Try again.');
      return;
    }
    const { token } = (await response.json()) as { token: string };
    setIssued({ name, token });
    setPairing(false);
    await load();
  }

  async function revoke(device: Device) {
    if (!window.confirm(`Disconnect ${device.name}? It stops syncing at once.`)) return;
    setError(null);
    const response = await fetch(`/api/sync/devices/${encodeURIComponent(device.id)}`, {
      method: 'DELETE',
    }).catch(() => null);
    if (response?.ok !== true) setError(`${device.name} couldn’t be disconnected. Try again.`);
    await load();
  }

  return (
    <div className="flex flex-col gap-6 font-sans">
      {issued === null ? null : (
        <section
          aria-labelledby="token-heading"
          className="border-border bg-card flex flex-col gap-3 rounded-md border p-4"
        >
          <h2 id="token-heading" className="text-heading text-foreground font-serif">
            Pair {issued.name}
          </h2>
          <p className="text-body text-foreground">
            Paste this into the You &amp; Friends app on the Mac.{' '}
            <strong>It won’t be shown again</strong> — if you lose it, disconnect the device and
            pair it anew.
          </p>
          <label className="text-caption text-muted-foreground" htmlFor="sync-token">
            Pairing token
          </label>
          <input
            id="sync-token"
            readOnly
            value={issued.token}
            onFocus={(event) => event.currentTarget.select()}
            className={cn(
              'border-border bg-background text-caption w-full rounded-md border p-2 font-mono',
              focusRing,
            )}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void navigator.clipboard?.writeText(issued.token)}>
              <Copy aria-hidden />
              Copy token
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>
              Done
            </Button>
          </div>
        </section>
      )}

      {pairing ? (
        <form
          className="border-border-subtle flex flex-col gap-3 rounded-md border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void pair(event.currentTarget);
          }}
        >
          <label className="text-body text-foreground flex flex-col gap-1">
            Device name
            <input
              name="name"
              maxLength={80}
              placeholder="Studio iMac"
              className={cn('border-border bg-card h-9 rounded-md border px-2', focusRing)}
            />
          </label>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-body text-foreground mb-1">
              Projects it may add snapshots to
            </legend>
            {projects.length === 0 ? (
              <p className="text-caption text-muted-foreground">
                There are no projects you can add files to yet.
              </p>
            ) : (
              projects.map((project) => (
                <label key={project.id} className="text-body touch-height flex items-center gap-2">
                  <input type="checkbox" name="project" value={project.id} className="size-5" />
                  {project.name}
                </label>
              ))
            )}
          </fieldset>
          <label className="text-body text-foreground flex flex-col gap-1">
            Stops working after
            <select
              name="expires"
              defaultValue="90"
              className={cn('border-border bg-card h-9 rounded-md border px-2', focusRing)}
            >
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">A year</option>
              <option value="never">Never — until disconnected</option>
            </select>
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm">
              Pair device
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPairing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button className="w-fit" onClick={() => setPairing(true)}>
          <Laptop aria-hidden />
          Pair a Mac
        </Button>
      )}

      {error === null ? null : (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}

      {devices === 'loading' ? (
        <p className="text-body text-muted-foreground">Loading devices…</p>
      ) : devices === 'error' ? (
        <p className="text-body text-muted-foreground">Devices couldn’t be loaded.</p>
      ) : devices.length === 0 ? (
        <p className="text-body text-muted-foreground">No devices paired yet.</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Paired devices">
          {devices.map((device) => {
            const disconnected = device.revokedAt !== null;
            const expired =
              !disconnected &&
              device.expiresAt !== null &&
              new Date(device.expiresAt).getTime() <= openedAt;
            return (
              <li
                key={device.id}
                className="border-border-subtle flex flex-col gap-1 rounded-md border p-3"
                data-state={disconnected ? 'disconnected' : expired ? 'expired' : 'connected'}
              >
                <p className="text-body text-foreground font-medium">
                  {device.name}
                  <span className="text-caption text-muted-foreground font-normal">
                    {' · '}
                    {disconnected ? 'Disconnected' : expired ? 'Expired' : 'Connected'}
                  </span>
                </p>
                <p className="text-caption text-muted-foreground">
                  Uploads to{' '}
                  {device.destinations.length === 0
                    ? 'nothing you can see'
                    : device.destinations.map((destination) => destination.name).join(', ')}
                  {device.mine || device.pairedBy === null ? '' : ` · paired by ${device.pairedBy}`}
                </p>
                <p className="text-caption text-muted-foreground">
                  {device.lastUsedAt === null ? (
                    'Never used'
                  ) : (
                    <>
                      Last used{' '}
                      <time dateTime={device.lastUsedAt}>
                        {when.format(new Date(device.lastUsedAt))}
                      </time>
                    </>
                  )}
                  {device.expiresAt === null || disconnected
                    ? ''
                    : ` · ${expired ? 'expired' : 'expires'} ${when.format(new Date(device.expiresAt))}`}
                </p>
                {disconnected ? null : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-fit"
                    onClick={() => void revoke(device)}
                  >
                    Disconnect {device.name}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
