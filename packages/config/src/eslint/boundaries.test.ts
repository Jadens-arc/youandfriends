import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

import { contractsBoundary, noRawColors } from './boundaries.mjs';

/**
 * Regression guard for the boundary rules.
 *
 * These rules are configuration. Before this test they were proven only by a manual probe,
 * which means a later edit could have dropped one and nothing would have failed. Here they
 * are exercised through the real ESLint API against real violating source.
 */

async function lint(config: unknown, code: string, filePath = 'probe.ts'): Promise<string[]> {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      // The TypeScript parser is required, or `import type` is a parse error rather than a
      // rule violation — which would make this guard silently useless for type-only imports.
      { files: ['**/*.{ts,tsx}'], languageOptions: { parser: tseslint.parser } },
      ...(config as never[]),
    ] as never,
  });
  const [result] = await eslint.lintText(code, { filePath });
  const messages = (result?.messages ?? []).map((m) => `${m.ruleId ?? 'unknown'}: ${m.message}`);
  // A parse error means the probe never reached the rule. Fail loudly rather than reporting
  // a misleading pass or failure.
  const parseError = messages.find((m) => m.includes('Parsing error'));
  if (parseError) throw new Error(`probe failed to parse: ${parseError}`);
  return messages;
}

describe('contracts dependency boundary', () => {
  it.each([
    ['exact infrastructure import', "import { thing } from '@youandfriends/db';"],
    ['subpath infrastructure import', "import { thing } from '@youandfriends/db/schema';"],
    ['storage subpath', "import { thing } from '@youandfriends/storage/driver';"],
    ['authz package', "import { thing } from '@youandfriends/authz';"],
    ['ui package', "import { thing } from '@youandfriends/ui';"],
    ['react', "import React from 'react';"],
    ['react subpath', "import { thing } from 'react-dom/server';"],
    ['next subpath', "import { headers } from 'next/headers';"],
    ['raw driver', "import { sql } from 'drizzle-orm';"],
    ['driver subpath', "import { thing } from 'drizzle-orm/pg-core';"],
    ['neon driver', "import { neon } from '@neondatabase/serverless';"],
    ['type-only import still counts', "import type { Row } from '@youandfriends/db';"],
  ])('rejects %s', async (_label, code) => {
    const messages = await lint(contractsBoundary, `${code}\nexport const probeValue = 1;\n`);
    expect(messages.join('\n')).toMatch(/no-restricted-imports/);
  });

  it.each([
    ['zod', "import { thing } from 'zod';"],
    ['config package', "import { PRODUCT_NAME } from '@youandfriends/config';"],
    ['relative sibling', "import { thing } from './ids';"],
    ['node builtin', "import { randomUUID } from 'node:crypto';"],
  ])('permits %s', async (_label, code) => {
    const messages = await lint(contractsBoundary, `${code}\nexport const probeValue = 1;\n`);
    expect(messages.join('\n')).not.toMatch(/no-restricted-imports/);
  });
});

describe('no raw colour literals', () => {
  it.each([
    ['six-digit hex', "export const c = '#F3EEE3';"],
    ['three-digit hex', "export const c = '#FFF';"],
    ['eight-digit hex', "export const c = '#F3EEE3FF';"],
    ['rgb()', "export const c = 'rgb(36 28 23)';"],
    ['rgba()', "export const c = 'rgba(36, 28, 23, 0.14)';"],
    ['hex inside a template string', 'export const c = `border: 1px solid #241C17`;'],
  ])('rejects %s', async (_label, code) => {
    const messages = await lint(noRawColors, code);
    expect(messages.join('\n')).toMatch(/Studio Notebook token/);
  });

  it.each([
    ['a token reference', "export const c = 'var(--color-canvas)';"],
    ['a tailwind class', "export const c = 'bg-canvas text-ink';"],
    ['an ordinary string with a hash', "export const c = 'see #3 in the changelog';"],
  ])('permits %s', async (_label, code) => {
    const messages = await lint(noRawColors, code);
    expect(messages.join('\n')).not.toMatch(/Studio Notebook token/);
  });

  it('exempts the token files themselves, which is where colours live', async () => {
    const messages = await lint(noRawColors, "export const canvas = '#F3EEE3';", 'tokens.ts');
    expect(messages.join('\n')).not.toMatch(/Studio Notebook token/);
  });
});
