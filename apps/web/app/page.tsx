import { PRODUCT_ATTRIBUTION, PRODUCT_NAME, PRODUCT_TAGLINE } from '@youandfriends/config';

/**
 * Placeholder landing surface.
 *
 * The real sign-in experience arrives in task `030` and the workspace shell in task `013`.
 * This page exists so the scaffold is genuinely runnable from the first commit.
 */
export default function Home() {
  return (
    <main className="shell">
      <h1 className="wordmark">{PRODUCT_NAME}</h1>
      <p className="tagline">{PRODUCT_TAGLINE}</p>
      <p className="attribution">A private music workspace {PRODUCT_ATTRIBUTION}.</p>
      <p className="scaffold-note">
        Scaffold only. The workspace is built task by task — see <code>tasks/STATUS.md</code>.
      </p>
    </main>
  );
}
