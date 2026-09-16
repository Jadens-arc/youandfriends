import { AppError } from '@youandfriends/contracts';
import { expect } from 'vitest';

/**
 * Helpers for the cross-workspace suite.
 *
 * The important one is {@link expectNotFoundShape}. A test that only asserts "not allowed"
 * passes against a 403, and a 403 confirms the resource exists — which is the disclosure
 * `docs/THREAT_MODEL.md` T1 is about. Asserting the *shape* is the control; asserting the
 * refusal is not.
 */

/**
 * Assert a refusal is indistinguishable from "no such thing".
 *
 * Checks all three: the public code the client is told, the HTTP status, and the message —
 * which must be byte-identical to a genuine not-found, or the difference itself is the leak.
 */
export function expectNotFoundShape(error: unknown): void {
  expect(error).toBeInstanceOf(AppError);
  const appError = error as AppError;

  // The true code survives internally, for the audit log. It never reaches the client.
  expect(appError.publicCode).toBe('not_found');
  expect(appError.httpStatus).toBe(404);
  expect(appError.message).toBe('Not found.');
}

/** Run an operation and return whatever it threw, or `null` if it did not throw. */
export async function caught(operation: Promise<unknown>): Promise<unknown> {
  return operation.then(
    () => null,
    (error: unknown) => error,
  );
}

/**
 * Assert that two refusals are indistinguishable.
 *
 * The one that matters: "this exists but is not yours" must look exactly like "this does not
 * exist". Comparing the serialized responses is stricter than checking each in isolation,
 * because it also catches a difference nobody thought to assert on.
 */
export function expectIndistinguishable(forbiddenError: unknown, missingError: unknown): void {
  expectNotFoundShape(forbiddenError);
  expectNotFoundShape(missingError);

  const shape = (error: unknown) => {
    const appError = error as AppError;
    return {
      code: appError.publicCode,
      message: appError.message,
      status: appError.httpStatus,
    };
  };

  expect(shape(forbiddenError)).toEqual(shape(missingError));
}
