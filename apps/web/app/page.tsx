import { PRODUCT_ATTRIBUTION, PRODUCT_NAME, PRODUCT_TAGLINE } from '@youandfriends/config';

/**
 * Placeholder landing surface.
 *
 * The real sign-in experience arrives in task `030` and the workspace shell in task `013`.
 * This exists so the scaffold is runnable, and so the token system has something to render.
 */
export default function Home() {
  return (
    <main className="paper-grain flex min-h-dvh flex-col items-center justify-center gap-3 px-4 py-8 text-center">
      <h1 className="text-foreground font-serif text-[clamp(2rem,8vw,3.25rem)] font-medium tracking-tight">
        {PRODUCT_NAME}
      </h1>
      <p className="text-muted-foreground font-serif text-[1.0625rem] italic">{PRODUCT_TAGLINE}</p>
      <p className="text-muted-foreground text-sm">
        A private music workspace {PRODUCT_ATTRIBUTION}.
      </p>
      <p className="border-border bg-card text-muted-foreground shadow-paper mt-6 rounded-md border px-3.5 py-2.5 text-sm">
        Scaffold only. The workspace is built task by task — see{' '}
        <code className="text-foreground font-mono">tasks/STATUS.md</code>.
      </p>
    </main>
  );
}
