import { PRODUCT_ATTRIBUTION, PRODUCT_NAME, PRODUCT_TAGLINE } from '@youandfriends/config';

/**
 * Placeholder landing surface.
 *
 * The real sign-in experience arrives in task `030` and the workspace shell in task `013`.
 * This exists so the scaffold is runnable, and so the token and type systems have something
 * to render.
 */
export default function Home() {
  return (
    <main className="paper-grain flex min-h-dvh flex-col items-center justify-center gap-3 px-4 py-8 text-center">
      <h1 className="text-display text-foreground font-serif font-medium">{PRODUCT_NAME}</h1>
      <p className="text-heading text-muted-foreground font-serif italic">{PRODUCT_TAGLINE}</p>
      <p className="text-body text-muted-foreground font-sans">
        A private music workspace {PRODUCT_ATTRIBUTION}.
      </p>
      <p className="text-caption text-muted-foreground shadow-paper border-border bg-card mt-6 rounded-md border px-3.5 py-2.5 font-sans">
        Scaffold only. The workspace is built task by task — see{' '}
        <code className="text-foreground font-mono">tasks/STATUS.md</code>.
      </p>
    </main>
  );
}
