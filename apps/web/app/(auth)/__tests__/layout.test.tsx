import { PRODUCT_ATTRIBUTION, PRODUCT_NAME, PRODUCT_TAGLINE } from '@youandfriends/config';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import AuthLayout from '../layout';

/**
 * The front door, and the one place the tagline is allowed to appear.
 *
 * `docs/DESIGN.md` §16 rules it out as interface chrome inside the workspace — a person who is
 * signed in already knows what the product is, and repeating it there competes with the work.
 * So this asserts both halves: that it is here, and that it is nowhere else.
 */
describe('the auth layout', () => {
  it('carries the product name, the tagline, and the attribution', () => {
    render(
      <AuthLayout>
        <div>sign-in form</div>
      </AuthLayout>,
    );

    // The ampersand, always (`CLAUDE.md` §12). `You and Friends` is a different product.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(PRODUCT_NAME);
    expect(PRODUCT_NAME).toContain('&');
    expect(screen.getByText(PRODUCT_TAGLINE)).toBeInTheDocument();
    expect(screen.getByText(PRODUCT_ATTRIBUTION)).toBeInTheDocument();
  });

  it('renders whatever Clerk puts inside it', () => {
    render(
      <AuthLayout>
        <div>sign-in form</div>
      </AuthLayout>,
    );
    expect(screen.getByText('sign-in form')).toBeInTheDocument();
  });

  it('is the only place the tagline appears', () => {
    // A source-level check, because the alternative is rendering every workspace surface and
    // hoping the one that regresses is among them. `PRODUCT_TAGLINE` is a constant, so an
    // import of it is the thing to count.
    const workspaceLayout = readFileSync(join(process.cwd(), 'app/(workspace)/layout.tsx'), 'utf8');
    expect(workspaceLayout).not.toContain('PRODUCT_TAGLINE');
  });
});
