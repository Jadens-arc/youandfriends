'use client';

import { cn, focusRing, transition } from '@youandfriends/ui';
import { Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { METADATA_FIELD_SCHEMAS, type MetadataField } from '@youandfriends/contracts';

import { postJson } from '@/lib/api/client';

export interface InlineFieldProps {
  /** The `PATCH` endpoint for the thing being edited. */
  readonly endpoint: string;
  /** The field name in the request body. */
  readonly field: string;
  /** The accessible name — "Title", "Artist", "Notes". */
  readonly label: string;
  readonly value: string | null;
  /** Shown, in italic, when there is no value. */
  readonly placeholder: string;
  readonly editable: boolean;
  /** Which shared rule validates this field, so the editor refuses what the server would. */
  readonly rule: MetadataField;
  readonly multiline?: boolean;
  /** Classes for the displayed text, so a title stays a title while being edited. */
  readonly className?: string;
  /** Render the displayed value as, e.g., a heading. */
  readonly as?: 'span' | 'h1' | 'p';
}

/**
 * One piece of metadata, edited in place (task `043`).
 *
 * For someone who may not edit, it is text — never a disabled input, which advertises a
 * capability they lack. For an editor it is a button that becomes a field; Enter or leaving the
 * field saves, Escape cancels. The new value shows at once (optimistic); if the server refuses,
 * the exact previous value comes back and a sentence says what failed and what it went back to,
 * so a rollback never reads as the app eating their input.
 */
export function InlineField({
  endpoint,
  field,
  label,
  value,
  placeholder,
  editable,
  rule,
  multiline = false,
  className,
  as: Display = 'span',
}: InlineFieldProps) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value ?? '');
  // The value on screen: the server's, or an optimistic one while a save is in flight.
  const [optimistic, setOptimistic] = React.useState<string | null | undefined>(undefined);
  const [error, setError] = React.useState<string | null>(null);
  const errorId = React.useId();
  const shown = optimistic === undefined ? value : optimistic;
  const cancelled = React.useRef(false);

  if (!editable) {
    return (
      <Display className={className}>
        {shown ?? <span className="italic opacity-80">{placeholder}</span>}
      </Display>
    );
  }

  async function save() {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const parsed = METADATA_FIELD_SCHEMAS[rule].safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? `Check the ${label.toLowerCase()}.`);
      return;
    }
    const next = (parsed.data as string | null) ?? null;
    setEditing(false);
    if (next === (value ?? null)) return;
    const previous = value;
    setOptimistic(next);
    setError(null);
    try {
      await postJson(endpoint, { [field]: draft }, 'PATCH');
      router.refresh();
    } catch (caught) {
      setOptimistic(undefined);
      setDraft(previous ?? '');
      const reason = caught instanceof Error ? caught.message : 'It did not save.';
      setError(
        `Couldn’t save the ${label.toLowerCase()}: ${reason} It’s back to ${
          previous === null ? 'empty' : `“${previous}”`
        }.`,
      );
    }
  }

  if (editing) {
    const common = {
      id: `${errorId}-input`,
      value: draft,
      autoFocus: true,
      'aria-label': label,
      'aria-describedby': error === null ? undefined : errorId,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setDraft(event.target.value),
      onBlur: () => void save(),
      className: cn(
        'border-border bg-card text-foreground w-full rounded-md border px-2 py-1',
        focusRing,
        className,
      ),
    };
    return (
      <div className="flex w-full flex-col gap-1">
        {multiline ? (
          <textarea
            {...common}
            rows={4}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                cancelled.current = true;
                setDraft(value ?? '');
                setEditing(false);
              }
            }}
          />
        ) : (
          <input
            {...common}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                // Saved here rather than by blurring, so a refused value keeps the focus on the
                // field that needs fixing.
                event.preventDefault();
                void save();
              } else if (event.key === 'Escape') {
                cancelled.current = true;
                setDraft(value ?? '');
                setEditing(false);
              }
            }}
          />
        )}
        {error === null ? null : (
          <p id={errorId} role="alert" className="text-caption text-destructive font-sans">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-1">
      <Display className={cn('min-w-0', className)}>
        <button
          type="button"
          onClick={() => {
            setDraft(shown ?? '');
            setEditing(true);
          }}
          aria-label={`Edit ${label.toLowerCase()}: ${shown ?? placeholder}`}
          className={cn(
            'group hover:bg-border-subtle -mx-1 inline-flex max-w-full items-baseline gap-2 rounded-sm px-1 text-left',
            transition,
            focusRing,
          )}
        >
          <span className={cn('break-words', multiline && 'whitespace-pre-wrap')}>
            {shown ?? <span className="italic opacity-80">{placeholder}</span>}
          </span>
          <Pencil
            aria-hidden
            className="text-muted-foreground size-3.5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        </button>
      </Display>
      {error === null ? null : (
        <p id={errorId} role="alert" className="text-caption text-destructive font-sans">
          {error}
        </p>
      )}
    </div>
  );
}

/** Status: a native select for editors (it saves on change), a worded badge for everyone else. */
export function InlineStatus({
  endpoint,
  value,
  options,
  editable,
  children,
}: {
  readonly endpoint: string;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly editable: boolean;
  /** What a non-editor sees — the status badge. */
  readonly children: React.ReactNode;
}) {
  const router = useRouter();
  const [optimistic, setOptimistic] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  if (!editable) return <>{children}</>;

  const previous = value;
  const current = optimistic ?? value;
  return (
    <span className="inline-flex flex-col gap-1">
      <select
        aria-label="Status"
        value={current}
        onChange={async (event) => {
          const next = event.target.value;
          setOptimistic(next);
          setError(null);
          try {
            await postJson(endpoint, { status: next }, 'PATCH');
            router.refresh();
          } catch (caught) {
            setOptimistic(null);
            const label = options.find((option) => option.value === previous)?.label ?? previous;
            setError(
              `Couldn’t change the status: ${caught instanceof Error ? caught.message : 'It did not save.'} It’s back to ${label}.`,
            );
          }
        }}
        className={cn(
          'border-border bg-card text-caption text-foreground h-8 rounded-sm border px-2 font-sans font-medium',
          focusRing,
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error === null ? null : (
        <span role="alert" className="text-caption text-destructive font-sans">
          {error}
        </span>
      )}
    </span>
  );
}
