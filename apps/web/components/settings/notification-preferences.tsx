'use client';

import { Button, cn, focusRing } from '@youandfriends/ui';
import { Lock } from 'lucide-react';
import * as React from 'react';

/**
 * Notification preferences (task `096`), grouped by category. In-app is a checkbox per event —
 * locked on for the events that must not be missed, with the reason given in words. Email is a
 * choice of off, immediately, or a daily digest; when this deployment cannot send email the
 * choice is not offered, and the page says why instead of showing a control that does nothing.
 */

export interface EventPreference {
  readonly event: string;
  readonly label: string;
  readonly inApp: boolean;
  readonly inAppLocked: boolean;
  readonly email: 'off' | 'immediate' | 'digest';
}

export interface PreferencesData {
  readonly email: { readonly available: boolean };
  readonly categories: readonly {
    readonly id: string;
    readonly label: string;
    readonly events: readonly EventPreference[];
  }[];
}

const EMAIL_LABELS = { off: 'Off', immediate: 'Right away', digest: 'Daily digest' } as const;

async function fetchPreferences(): Promise<PreferencesData | 'error'> {
  try {
    const response = await fetch('/api/notifications/preferences', { cache: 'no-store' });
    if (!response.ok) return 'error';
    return (await response.json()) as PreferencesData;
  } catch {
    return 'error';
  }
}

export function NotificationPreferences() {
  const [data, setData] = React.useState<PreferencesData | 'error' | null>(null);
  const [status, setStatus] = React.useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  React.useEffect(() => {
    void fetchPreferences().then(setData);
  }, []);

  if (data === null) {
    return <p className="text-body text-muted-foreground font-sans">Loading your preferences…</p>;
  }
  if (data === 'error') {
    return (
      <p className="text-body text-muted-foreground font-sans">
        Your preferences could not be loaded.
      </p>
    );
  }

  const change = async (
    event: string,
    patch: Partial<Pick<EventPreference, 'inApp' | 'email'>>,
  ) => {
    const before = data;
    const next: PreferencesData = {
      ...data,
      categories: data.categories.map((category) => ({
        ...category,
        events: category.events.map((row) => (row.event === event ? { ...row, ...patch } : row)),
      })),
    };
    setData(next);
    setStatus('saving');
    const row = next.categories
      .flatMap((category) => category.events)
      .find((r) => r.event === event);
    try {
      const response = await fetch('/api/notifications/preferences', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          preferences: row === undefined ? [] : [{ event, inApp: row.inApp, email: row.email }],
        }),
      });
      if (!response.ok) throw new Error(String(response.status));
      setData((await response.json()) as PreferencesData);
      setStatus('saved');
    } catch {
      setData(before);
      setStatus('failed');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {data.email.available ? null : (
        <p className="border-border bg-card text-body text-foreground rounded-md border p-3 font-sans">
          Email notifications are not available — email delivery has not been set up for this
          workspace. Everything below still arrives in the app.
        </p>
      )}
      <p aria-live="polite" className="text-caption text-muted-foreground min-h-5 font-sans">
        {status === 'saving'
          ? 'Saving…'
          : status === 'saved'
            ? 'Saved.'
            : status === 'failed'
              ? 'That change was not saved. Try again.'
              : ''}
      </p>
      {data.categories.map((category) => (
        <section
          key={category.id}
          aria-labelledby={`prefs-${category.id}`}
          className="flex flex-col gap-2"
        >
          <h2 id={`prefs-${category.id}`} className="text-heading text-foreground font-serif">
            {category.label}
          </h2>
          <ul className="border-border bg-card divide-border-subtle divide-y rounded-md border">
            {category.events.map((row) => (
              <PreferenceRow
                key={row.event}
                row={row}
                emailAvailable={data.email.available}
                onChange={(patch) => void change(row.event, patch)}
              />
            ))}
          </ul>
        </section>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="w-fit max-md:min-h-11"
        onClick={() => void fetchPreferences().then(setData)}
      >
        Reload
      </Button>
    </div>
  );
}

function PreferenceRow({
  row,
  emailAvailable,
  onChange,
}: {
  readonly row: EventPreference;
  readonly emailAvailable: boolean;
  readonly onChange: (patch: Partial<Pick<EventPreference, 'inApp' | 'email'>>) => void;
}) {
  const id = React.useId();
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <span id={`${id}-label`} className="text-body text-foreground font-sans">
        {row.label}
      </span>
      <div className="flex flex-wrap items-center gap-4">
        <label className="text-caption text-foreground flex min-h-11 items-center gap-2 font-sans sm:min-h-0">
          <input
            type="checkbox"
            checked={row.inApp}
            disabled={row.inAppLocked}
            aria-describedby={row.inAppLocked ? `${id}-locked` : undefined}
            onChange={(event) => onChange({ inApp: event.target.checked })}
            className={cn('accent-primary size-4', focusRing)}
          />
          In the app
          {row.inAppLocked ? (
            <span id={`${id}-locked`} className="text-muted-foreground flex items-center gap-1">
              <Lock aria-hidden className="size-3" />
              always on
            </span>
          ) : null}
        </label>
        {emailAvailable ? (
          <label className="text-caption text-foreground flex items-center gap-2 font-sans">
            Email
            <select
              value={row.email}
              aria-label={`Email for “${row.label}”`}
              onChange={(event) =>
                onChange({ email: event.target.value as EventPreference['email'] })
              }
              className={cn(
                'border-border bg-background text-caption rounded-sm border px-2 py-1 max-md:min-h-11',
                focusRing,
              )}
            >
              {(['off', 'immediate', 'digest'] as const).map((mode) => (
                <option key={mode} value={mode}>
                  {EMAIL_LABELS[mode]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
    </li>
  );
}
