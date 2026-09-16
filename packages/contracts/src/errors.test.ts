import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  AppError,
  conflict,
  fieldErrorsFromZod,
  forbidden,
  internal,
  notFound,
  rateLimited,
  toErrorResponse,
  toHttpStatus,
  unauthorized,
  validationFailed,
} from './errors';

describe('forbidden presents as not found', () => {
  // THREAT_MODEL T1: a 403 confirms the resource exists, which leaks across a tenant
  // boundary. This is the single most important behaviour in this module.
  it('serializes a 404-shaped body', () => {
    const response = toErrorResponse(forbidden());
    expect(response.code).toBe('not_found');
    expect(response.message).toBe('Not found.');
  });

  it('returns HTTP 404, not 403', () => {
    expect(toHttpStatus(forbidden())).toBe(404);
  });

  it('is indistinguishable from a genuine not-found on the wire', () => {
    expect(toErrorResponse(forbidden())).toEqual(toErrorResponse(notFound()));
  });

  it('keeps the true cause internally, for audit and logging', () => {
    const error = forbidden({ detail: 'user lacks editor on song 01J8XK' });
    expect(error.code).toBe('forbidden');
    expect(error.publicCode).toBe('not_found');
    expect(error.detail).toBe('user lacks editor on song 01J8XK');
  });
});

describe('serialization leaks nothing internal', () => {
  it('omits the detail field entirely', () => {
    const response = toErrorResponse(
      notFound({ detail: 'SELECT * FROM songs WHERE workspace_id = $1' }),
    );
    expect(JSON.stringify(response)).not.toContain('SELECT');
    expect(response).not.toHaveProperty('detail');
  });

  it('omits stack traces', () => {
    const response = toErrorResponse(internal({ cause: new Error('inner') }));
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain('at ');
    expect(response).not.toHaveProperty('stack');
  });

  it('turns an unrecognized throw into a bare internal error', () => {
    for (const thrown of [
      new Error('connect ECONNREFUSED 10.0.0.1:5432'),
      'raw string with s3://bucket/secret-key',
      { sql: 'DROP TABLE songs', key: 'w/ws_1/o/01J8XK' },
      null,
      undefined,
    ]) {
      const response = toErrorResponse(thrown);
      expect(response.code).toBe('internal');
      expect(response.message).toBe('Something went wrong on our end.');
      const serialized = JSON.stringify(response);
      expect(serialized).not.toContain('ECONNREFUSED');
      expect(serialized).not.toContain('DROP TABLE');
      expect(serialized).not.toContain('s3://');
      expect(serialized).not.toContain('w/ws_1');
    }
  });

  it('never attaches field errors to a non-validation code', () => {
    const error = new AppError('conflict', { fields: [{ path: 'title', message: 'bad' }] });
    expect(toErrorResponse(error)).not.toHaveProperty('fields');
  });
});

describe('correlation IDs carry diagnosis instead of detail', () => {
  it('includes the correlation ID when one is supplied', () => {
    expect(toErrorResponse(internal(), 'c-123').correlationId).toBe('c-123');
  });

  it("prefers the error's own ID over the ambient one", () => {
    expect(
      toErrorResponse(internal({ correlationId: 'from-error' }), 'ambient').correlationId,
    ).toBe('from-error');
  });

  it('omits the field when there is no ID, rather than sending undefined', () => {
    expect(toErrorResponse(internal())).not.toHaveProperty('correlationId');
  });
});

describe("validation errors describe the caller's own input", () => {
  it('returns field errors, which are safe to show', () => {
    const response = toErrorResponse(
      validationFailed([{ path: 'title', message: 'must not be empty' }]),
    );
    expect(response.code).toBe('validation_failed');
    expect(response.fields).toEqual([{ path: 'title', message: 'must not be empty' }]);
  });

  it('converts a Zod error into field errors', () => {
    const schema = z.object({ title: z.string().min(1), bpm: z.number() });
    const result = schema.safeParse({ title: '', bpm: 'fast' });
    expect(result.success).toBe(false);
    const fields = fieldErrorsFromZod(result.error!);
    expect(fields.map((f) => f.path).sort()).toEqual(['bpm', 'title']);
  });
});

describe('http status mapping', () => {
  it.each([
    [notFound(), 404],
    [forbidden(), 404],
    [unauthorized(), 401],
    [validationFailed([]), 422],
    [conflict(), 409],
    [rateLimited(), 429],
    [internal(), 500],
  ])('maps %s correctly', (error, status) => {
    expect(toHttpStatus(error)).toBe(status);
  });

  it('maps an unrecognized throw to 500', () => {
    expect(toHttpStatus('not an error')).toBe(500);
  });
});
