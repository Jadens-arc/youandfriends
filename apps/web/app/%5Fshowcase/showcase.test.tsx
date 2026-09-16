import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen } from '@testing-library/react';
import { surface } from '@youandfriends/ui';
import { describe, expect, it } from 'vitest';

import ShowcasePage from './page.dev';

const HERE = resolve(process.cwd(), 'app/%5Fshowcase');
const PARTS = resolve(HERE, '_parts');
const UI_COMPONENTS = resolve(process.cwd(), '../../packages/ui/src/components');

const partSources = readdirSync(PARTS)
  .filter((name) => name.endsWith('.tsx'))
  .map((name) => readFileSync(resolve(PARTS, name), 'utf8'));

const showcaseSource = [readFileSync(resolve(HERE, 'page.dev.tsx'), 'utf8'), ...partSources].join(
  '\n',
);

describe('showcase coverage of the design system', () => {
  const componentFiles = readdirSync(UI_COMPONENTS).filter(
    (name) => name.endsWith('.tsx') && !name.includes('.test.'),
  );

  it.each(componentFiles)('shows something from %s', (file) => {
    const source = readFileSync(resolve(UI_COMPONENTS, file), 'utf8');
    const exported = [...source.matchAll(/^export (?:const|function) (\w+)/gm)].map(
      (match) => match[1],
    );

    expect(exported.length).toBeGreaterThan(0);
    // A primitive that exists but is not on this page is a primitive nobody is checking for
    // drift. Adding a component file without showing it here fails right here.
    expect(exported.some((name) => name && showcaseSource.includes(`<${name}`))).toBe(true);
  });

  it('imports components only from the published package', () => {
    // A local copy would drift, and a drifting showcase is worse than none — it still looks
    // like evidence.
    for (const source of partSources) {
      expect(source).not.toMatch(/from '[.@/]*(?:components|packages\/ui\/src)/);
    }
  });
});

describe('ShowcasePage', () => {
  it('renders every section the index links to', () => {
    render(<ShowcasePage />);

    const links = screen.getAllByRole('link');
    const targets = links
      .map((link) => link.getAttribute('href'))
      .filter((href): href is string => href?.startsWith('#') === true);

    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(
        document.querySelector(`[data-testid="showcase-section-${target.slice(1)}"]`),
      ).not.toBeNull();
    }
  });

  it('renders the token sheets from the token module, not from copied values', () => {
    render(<ShowcasePage />);

    for (const sheet of [
      'surfaces',
      'text',
      'accents',
      'borders',
      'type',
      'radii',
      'elevation',
      'motion',
    ]) {
      expect(screen.getByTestId(`showcase-tokens-${sheet}`)).toBeInTheDocument();
    }
    // Asserted through the module, not a literal: a hardcoded hex here would be the very
    // drift the page exists to prevent, and the lint rule catches it either way.
    expect(screen.getAllByText(surface.canvas).length).toBeGreaterThan(0);
  });

  it('carries stable anchors for the browser-driven assertions in task 120', () => {
    render(<ShowcasePage />);

    for (const anchor of [
      'showcase',
      'showcase-button-primary',
      'showcase-input',
      'showcase-checkbox',
      'showcase-select',
      'showcase-dropdown-menu',
      'showcase-tooltip',
      'showcase-frame-phone',
      'showcase-frame-desktop',
    ]) {
      expect(screen.getByTestId(anchor)).toBeInTheDocument();
    }
  });

  it('frames the responsive shell in real iframes, which have their own viewport', () => {
    render(<ShowcasePage />);

    // A fixed-width div would still resolve `md:` against the outer viewport and show the
    // desktop shell at phone width — the wrong answer, confidently.
    const phone = screen.getByTestId('showcase-frame-phone');
    expect(phone.tagName).toBe('IFRAME');
    expect(phone).toHaveAttribute('width', '390');
    expect(phone).toHaveAttribute('src', '/library');
  });

  it('is not indexable even where it is served', () => {
    // Preview deployments are reachable; a crawler finding the showcase would be a surprise.
    expect(showcaseSource).toMatch(/robots:\s*\{\s*index:\s*false/);
  });
});
