'use client';

/**
 * Root error boundary.
 *
 * Replaces the Next.js built-in fallback. It must render without the application shell,
 * because it also catches errors thrown by the root layout itself. Task `002` wires the
 * observability hook here so errors reach Sentry when a DSN is configured.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main className="shell">
          <h1 className="wordmark">Something went wrong</h1>
          <p className="tagline">Your work is safe.</p>
          <button type="button" onClick={reset}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
