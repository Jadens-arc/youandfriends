import { describe, expect, it } from 'vitest';

import cases from './snapshots.cases.json';
import {
  DEFAULT_IGNORE_RULES,
  createSnapshotSchema,
  matchIgnoreRule,
  normalizeRelativePath,
} from './snapshots';

describe('normalizeRelativePath — the golden cases shared with the Mac agent', () => {
  for (const testCase of cases.paths) {
    it(`${JSON.stringify(testCase.input)} → ${'expect' in testCase ? testCase.expect : `rejected (${testCase.reject})`}`, () => {
      const result = normalizeRelativePath(testCase.input);
      if ('expect' in testCase) {
        expect(result).toEqual({ ok: true, path: testCase.expect });
      } else {
        expect(result).toEqual({ ok: false, reason: testCase.reject });
      }
    });
  }
});

describe('matchIgnoreRule — the golden cases shared with the Mac agent', () => {
  for (const testCase of cases.ignore) {
    it(`${testCase.path} → ${testCase.rule ?? 'kept'}`, () => {
      expect(matchIgnoreRule(testCase.path)?.id ?? null).toBe(testCase.rule);
    });
  }

  it('gives every default rule a sentence, not a code', () => {
    for (const rule of DEFAULT_IGNORE_RULES) expect(rule.reason).toMatch(/^\S.{8,}\.$/);
  });

  it('honours user-configured patterns, including across segments', () => {
    const rules = [{ id: 'renders', pattern: 'Renders/**', reason: 'Renders are rebuilt.' }];
    expect(matchIgnoreRule('Renders/a/b.wav', rules)?.id).toBe('renders');
    expect(matchIgnoreRule('Audio/Renders.wav', rules)).toBeNull();
  });
});

describe('createSnapshotSchema', () => {
  it('bounds and types every manifest entry', () => {
    const entry = {
      path: 'a.wav',
      sizeBytes: 1,
      modifiedAt: null,
      checksumSha256: null,
      ignored: false,
      ignoreReason: null,
    };
    const base = { projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', name: 'Session' };
    expect(createSnapshotSchema.safeParse({ ...base, entries: [entry] }).success).toBe(true);
    expect(createSnapshotSchema.safeParse({ ...base, entries: [] }).success).toBe(false);
    expect(
      createSnapshotSchema.safeParse({ ...base, entries: [{ ...entry, sizeBytes: -1 }] }).success,
    ).toBe(false);
    expect(
      createSnapshotSchema.safeParse({ ...base, entries: [{ ...entry, checksumSha256: 'x' }] })
        .success,
    ).toBe(false);
  });
});
