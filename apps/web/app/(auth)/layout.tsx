import { PRODUCT_ATTRIBUTION, PRODUCT_NAME, PRODUCT_TAGLINE } from '@youandfriends/config';

/**
 * The front door (`docs/DESIGN.md` §1 and §16).
 *
 * **This is the one place the tagline appears.** Inside the workspace it would be interface
 * chrome competing with the work, which §16 rules out — a person who is signed in already knows
 * what the product is. Here it is the promise being made.
 *
 * Centred on the warm paper ground rather than the workspace's espresso shell: signing in is a
 * threshold, not a screen inside the app, and it should not look like one.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-background flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-12">
      <header className="flex flex-col items-center gap-2 text-center">
        <h1 className="font-display text-foreground text-3xl tracking-tight">{PRODUCT_NAME}</h1>
        <p className="text-muted-foreground text-sm text-balance italic">{PRODUCT_TAGLINE}</p>
      </header>

      {children}

      <footer className="text-muted-foreground text-xs">{PRODUCT_ATTRIBUTION}</footer>
    </main>
  );
}
