'use client';

import {
  NOTIFICATION_CATEGORIES,
  type EmailMode,
  type NotificationEvent,
  type ResolvedPreferences,
} from '@youandfriends/contracts';
import { cn, focusRing } from '@youandfriends/ui';
import * as React from 'react';

/**
 * Notification preferences (task `096`): events grouped as a person thinks of them, a switch per
 * channel. The always-in-app events are shown on and locked, with why. When email is not set up,
 * the email column is not offered at all and the page says so — an email switch that does nothing
 * would be a lie.
 *
 * Each change saves as it is made, and says so; a failed save puts the switch back.
 */

interface View {
  readonly preferences: ResolvedPreferences;
  readonly emailMode: EmailMode;
  readonly alwaysInApp: readonly NotificationEvent[];
  readonly email: { readonly available: boolean };
}

type Channel = 'in_app' | 'email';

const TARGET = 'touch-target';

async function save(body: unknown): Promise<View | null> {
  const response = await fetch('/api/notifications/preferences', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.ok ? ((await response.json()) as View) : null;
}

export function NotificationPreferencesForm() {
  const [view, setView] = React.useState<View | 'loading' | 'error'>('loading');
  const [status, setStatus] = React.useState<{ kind: 'saved' | 'error'; text: string } | null>(
    null,
  );

  React.useEffect(() => {
    let cancelled = false;
    void fetch('/api/notifications/preferences', { cache: 'no-store' })
      .then(async (response) => (response.ok ? ((await response.json()) as View) : null))
      .catch(() => null)
      .then((loaded) => {
        if (!cancelled) setView(loaded ?? 'error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (view === 'loading') {
    return <p className="text-body text-muted-foreground font-sans">Loading your preferences…</p>;
  }
  if (view === 'error') {
    return (
      <p className="text-body text-muted-foreground font-sans">
        Your preferences couldn’t be loaded.
      </p>
    );
  }
  const current = view;

  async function change(body: unknown, optimistic: View, label: string) {
    setView(optimistic);
    setStatus(null);
    const saved = await save(body);
    if (saved === null) {
      setView(current);
      setStatus({ kind: 'error', text: `${label} didn’t save. Try again.` });
      return;
    }
    setView(saved);
    setStatus({ kind: 'saved', text: `${label} saved.` });
  }

  function toggle(event: NotificationEvent, channel: Channel, enabled: boolean, label: string) {
    void change(
      { preferences: [{ event, channel, enabled }] },
      {
        ...current,
        preferences: {
          ...current.preferences,
          [event]: { ...current.preferences[event], [channel]: enabled },
        },
      },
      label,
    );
  }

  const emailing = current.email.available;
  return (
    <div className="flex flex-col gap-6 font-sans">
      {emailing ? null : (
        <p
          className="border-border-subtle text-body text-foreground rounded-md border p-3"
          data-email="unavailable"
        >
          Email notifications aren’t available yet — this workspace hasn’t set up email. You’ll
          still see everything in {'the '}
          <a href="/notifications" className={cn('underline underline-offset-4', focusRing)}>
            notification center
          </a>
          .
        </p>
      )}
      {NOTIFICATION_CATEGORIES.map((category) => (
        <fieldset key={category.label} className="flex flex-col gap-2">
          <legend className="text-heading text-foreground mb-2 font-serif">{category.label}</legend>
          <div
            className={cn(
              'text-caption text-muted-foreground grid items-center gap-x-4',
              emailing ? 'grid-cols-[1fr_auto_auto]' : 'grid-cols-[1fr_auto]',
            )}
            aria-hidden
          >
            <span />
            <span>In the app</span>
            {emailing ? <span>Email</span> : null}
          </div>
          {category.events.map(({ event, label }) => {
            const locked = current.alwaysInApp.includes(event);
            const prefs = current.preferences[event];
            const id = `pref-${event.replace('.', '-')}`;
            return (
              <div
                key={event}
                className={cn(
                  'grid items-center gap-x-4 max-md:min-h-11',
                  emailing ? 'grid-cols-[1fr_auto_auto]' : 'grid-cols-[1fr_auto]',
                )}
              >
                <span id={id} className="text-body text-foreground">
                  {label}
                  {locked ? (
                    <span className="text-caption text-muted-foreground block">
                      Always shown in the app
                    </span>
                  ) : null}
                </span>
                {/* The label is the target: 44×44 on a phone, around a box that stays box-sized. */}
                <label className={TARGET}>
                  <input
                    type="checkbox"
                    aria-label={`${label} — in the app`}
                    aria-describedby={id}
                    checked={prefs.in_app}
                    disabled={locked}
                    onChange={(input) =>
                      toggle(event, 'in_app', input.target.checked, `${label} in the app`)
                    }
                    className={cn('size-5', focusRing)}
                  />
                </label>
                {emailing ? (
                  <label className={TARGET}>
                    <input
                      type="checkbox"
                      aria-label={`${label} — by email`}
                      aria-describedby={id}
                      checked={prefs.email}
                      onChange={(input) =>
                        toggle(event, 'email', input.target.checked, `${label} by email`)
                      }
                      className={cn('size-5', focusRing)}
                    />
                  </label>
                ) : null}
              </div>
            );
          })}
        </fieldset>
      ))}
      {emailing ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-heading text-foreground mb-2 font-serif">When to email</legend>
          {(
            [
              ['immediate', 'As it happens'],
              ['daily', 'Once a day, in one email'],
            ] as const
          ).map(([mode, label]) => (
            <label
              key={mode}
              className="text-body text-foreground flex items-center gap-2 max-md:min-h-11"
            >
              <input
                type="radio"
                name="email-mode"
                value={mode}
                checked={current.emailMode === mode}
                onChange={() =>
                  void change({ emailMode: mode }, { ...current, emailMode: mode }, 'When to email')
                }
                className={cn('size-5', focusRing)}
              />
              {label}
            </label>
          ))}
        </fieldset>
      ) : null}
      <p
        role={status?.kind === 'error' ? 'alert' : 'status'}
        className={cn(
          'text-caption',
          status?.kind === 'error' ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {status?.text ?? ''}
      </p>
    </div>
  );
}
