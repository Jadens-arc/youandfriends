import { isUlid, newUlid } from '@youandfriends/contracts';
import { describe, expect, it } from 'vitest';

import {
  classPrefix,
  derivativeObjectKey,
  newObjectKey,
  parseObjectKey,
  workspacePrefix,
} from './keys';

const WORKSPACE = '01J8XKQ2M3N4P5R6S7T8V9W0XY';

describe('object keys are opaque', () => {
  it('is built from the workspace, the class, and a fresh ULID', () => {
    const key = newObjectKey(WORKSPACE, 'original');
    const parts = key.split('/');

    expect(parts[0]).toBe('w');
    expect(parts[1]).toBe(WORKSPACE);
    expect(parts[2]).toBe('o');
    expect(isUlid(parts[3] ?? '')).toBe(true);
  });

  it('never repeats', () => {
    const keys = new Set(Array.from({ length: 500 }, () => newObjectKey(WORKSPACE, 'original')));
    expect(keys.size).toBe(500);
  });

  it('separates the classes, so a lifecycle rule can differ per class', () => {
    // Derivatives are regenerable and may be purged aggressively; originals never are. One
    // shared prefix would make that rule impossible to express without listing every object.
    const prefixes = (['original', 'derivative', 'snapshot'] as const).map(
      (kind) => newObjectKey(WORKSPACE, kind).split('/')[2],
    );
    expect(new Set(prefixes).size).toBe(3);
  });

  it('carries nothing a caller supplied', () => {
    // The property this exists for. A key built from a filename leaks the filename to whoever
    // sees a presigned URL — a forwarded link, a browser history — and "Unreleased - Blue Hour
    // FINAL.wav" is exactly what this product exists not to leak (THREAT_MODEL T3).
    //
    // `newObjectKey` takes no filename at all, so the test is that its whole output is
    // accounted for by the three server-generated parts.
    const key = newObjectKey(WORKSPACE, 'original');
    const { workspaceId, objectClass, id } = parseObjectKey(key) ?? {};
    expect(`w/${workspaceId}/o/${id}`).toBe(key);
    expect(objectClass).toBe('original');
  });

  it('round-trips through the parser', () => {
    for (const kind of ['original', 'derivative', 'snapshot'] as const) {
      const key = newObjectKey(WORKSPACE, kind);
      expect(parseObjectKey(key)).toEqual({
        workspaceId: WORKSPACE,
        objectClass: kind,
        id: key.split('/')[3],
      });
    }
  });

  it('refuses to parse anything that is not one of ours', () => {
    // Reconciliation uses the parser to decide whether a key in the bucket is ours. Accepting a
    // traversal-shaped or foreign key there would have it report on objects it does not own.
    for (const key of [
      '',
      'w/',
      `w/${WORKSPACE}/o`,
      `w/${WORKSPACE}/o/x/y`,
      `w//o/${WORKSPACE}`,
      `w/${WORKSPACE}/o/`,
      `w/${WORKSPACE}/x/abc`,
      `../${WORKSPACE}/o/abc`,
      `W/${WORKSPACE}/o/abc`,
    ]) {
      expect(parseObjectKey(key), JSON.stringify(key)).toBeNull();
    }
  });

  it('gives operators prefixes that are bounded by a slash', () => {
    // Without the trailing slash, a prefix for workspace `01J8` would also match `01J8X…` —
    // a lifecycle rule or a listing scoped to one tenant would reach into another's.
    expect(workspacePrefix(WORKSPACE).endsWith('/')).toBe(true);
    expect(classPrefix(WORKSPACE, 'derivative').endsWith('/')).toBe(true);
    expect(
      newObjectKey(WORKSPACE, 'derivative').startsWith(classPrefix(WORKSPACE, 'derivative')),
    ).toBe(true);
  });
});

describe('derivative keys (task `064`)', () => {
  it('is the same key for the same row, so a retry overwrites rather than orphans', () => {
    const workspace = newUlid();
    const derivative = newUlid();
    expect(derivativeObjectKey(workspace, derivative)).toBe(
      derivativeObjectKey(workspace, derivative),
    );
    expect(parseObjectKey(derivativeObjectKey(workspace, derivative))).toEqual({
      workspaceId: workspace,
      objectClass: 'derivative',
      id: derivative,
    });
  });

  it('refuses an id that is not a server-issued ULID', () => {
    expect(() => derivativeObjectKey(newUlid(), '../o/x')).toThrow(/ULID/);
  });
});
