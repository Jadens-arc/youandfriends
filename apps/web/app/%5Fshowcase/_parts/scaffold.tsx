import { cn } from '@youandfriends/ui';

/**
 * Layout scaffolding for the showcase.
 *
 * Deliberately plain: it frames the components without being one of them. Anything here that
 * started to look like a design-system primitive would be a local copy, which is exactly
 * what the showcase exists to rule out.
 */
export function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <section id={id} data-testid={`showcase-section-${id}`} className="scroll-mt-4">
      <h2 className="text-title border-border text-foreground border-b pb-1 font-serif">{title}</h2>
      {note ? <p className="text-caption text-muted-foreground mt-2 font-sans">{note}</p> : null}
      <div className="mt-4 flex flex-col gap-6">{children}</div>
    </section>
  );
}

/** A labelled group of states for one component. */
export function States({
  label,
  testId,
  className,
  children,
}: {
  label: string;
  testId?: string | undefined;
  className?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div {...(testId === undefined ? {} : { 'data-testid': testId })}>
      <p className="text-caption text-muted-foreground font-sans">{label}</p>
      <div className={cn('mt-2 flex flex-wrap items-center gap-3', className)}>{children}</div>
    </div>
  );
}
