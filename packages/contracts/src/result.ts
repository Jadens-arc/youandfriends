/**
 * Route handler results.
 *
 * A small Result type so handlers return failures instead of throwing them across a boundary
 * where the catch site might serialize something it should not. `toResponseBody` is the only
 * sanctioned way to turn a failure into a wire payload.
 */

import { toErrorResponse, toHttpStatus, type ErrorResponse } from './errors';

export type Result<T, E = unknown> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}

/** Wrap a throwing function into a Result. */
export async function attempt<T>(fn: () => Promise<T> | T): Promise<Result<T, unknown>> {
  try {
    return ok(await fn());
  } catch (error) {
    return err(error);
  }
}

/**
 * Turn a failure into the HTTP status and body to send.
 *
 * Every error path in the API should end here, so there is exactly one place where the
 * decision "what may a client see" is made.
 */
export function toResponseBody(
  error: unknown,
  correlationId?: string,
): { status: number; body: ErrorResponse } {
  return {
    status: toHttpStatus(error),
    body: toErrorResponse(error, correlationId),
  };
}
