/**
 * Error taxonomy.
 *
 * Two rules govern everything here, and both are security behaviours rather than conveniences:
 *
 * 1. **Forbidden serializes 404-shaped for tenant-scoped resources.** A 403 confirms the
 *    resource exists, which is information disclosure across a tenant boundary
 *    (docs/THREAT_MODEL.md T1). The distinction survives internally for audit and logging;
 *    it just never reaches the client.
 *
 * 2. **Nothing internal reaches the client.** No stack traces, no SQL, no storage keys, no
 *    internal identifiers. The response carries a correlation ID; the diagnostic detail goes
 *    to the log under that same ID (task `002`).
 */

import { z } from 'zod';

export const ERROR_CODES = [
  'not_found',
  'forbidden',
  'unauthorized',
  'validation_failed',
  'conflict',
  'rate_limited',
  'internal',
] as const;
export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Messages safe to render directly to a user. Deliberately uninformative about internals. */
const SAFE_MESSAGES: Record<ErrorCode, string> = {
  not_found: 'Not found.',
  forbidden: 'Not found.', // see rule 1 — deliberately identical to not_found
  unauthorized: 'You need to sign in to continue.',
  validation_failed: 'Some of the submitted values are invalid.',
  conflict: 'This changed somewhere else. Reload and try again.',
  rate_limited: 'Too many requests. Try again shortly.',
  internal: 'Something went wrong on our end.',
};

const HTTP_STATUS: Record<ErrorCode, number> = {
  not_found: 404,
  forbidden: 404, // see rule 1
  unauthorized: 401,
  validation_failed: 422,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
};

/** A field-level validation problem, safe to show beside the input that caused it. */
export const fieldErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
});
export type FieldError = z.infer<typeof fieldErrorSchema>;

/** The wire shape. This is everything a client ever sees. */
export const errorResponseSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  correlationId: z.string().optional(),
  fields: z.array(fieldErrorSchema).optional(),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/**
 * An application error.
 *
 * `code` is the true cause and is what gets audited and logged. `publicCode` is what the
 * client is told — they differ only for `forbidden`, which presents as `not_found`.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly correlationId: string | undefined;
  readonly fields: readonly FieldError[] | undefined;
  /** Detail for the log only. Never serialized to a client. */
  readonly detail: string | undefined;

  constructor(
    code: ErrorCode,
    options: {
      detail?: string;
      correlationId?: string;
      fields?: readonly FieldError[];
      cause?: unknown;
    } = {},
  ) {
    super(SAFE_MESSAGES[code], options.cause === undefined ? {} : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.correlationId = options.correlationId;
    this.fields = options.fields;
    this.detail = options.detail;
  }

  /** The code presented to the client. `forbidden` becomes `not_found` (rule 1). */
  get publicCode(): ErrorCode {
    return this.code === 'forbidden' ? 'not_found' : this.code;
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.code];
  }
}

export const notFound = (o?: ConstructorParameters<typeof AppError>[1]) =>
  new AppError('not_found', o);
export const forbidden = (o?: ConstructorParameters<typeof AppError>[1]) =>
  new AppError('forbidden', o);
export const unauthorized = (o?: ConstructorParameters<typeof AppError>[1]) =>
  new AppError('unauthorized', o);
export const conflict = (o?: ConstructorParameters<typeof AppError>[1]) =>
  new AppError('conflict', o);
export const rateLimited = (o?: ConstructorParameters<typeof AppError>[1]) =>
  new AppError('rate_limited', o);
export const internal = (o?: ConstructorParameters<typeof AppError>[1]) =>
  new AppError('internal', o);

export function validationFailed(
  fields: readonly FieldError[],
  o?: Omit<ConstructorParameters<typeof AppError>[1] & object, 'fields'>,
): AppError {
  return new AppError('validation_failed', { ...o, fields });
}

/** Convert a Zod error into field errors safe to return to the client. */
export function fieldErrorsFromZod(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * Serialize any thrown value into the wire shape.
 *
 * An unrecognized throw becomes `internal` with no detail — an unexpected error is exactly
 * the case most likely to carry a stack trace or a database message, so it is never passed
 * through.
 */
export function toErrorResponse(error: unknown, correlationId?: string): ErrorResponse {
  if (error instanceof AppError) {
    const code = error.publicCode;
    const response: ErrorResponse = { code, message: SAFE_MESSAGES[code] };
    const id = error.correlationId ?? correlationId;
    if (id !== undefined) response.correlationId = id;
    // Field errors describe the caller's own input, so they are safe to return — but only
    // for a validation failure, never attached to some other code.
    if (code === 'validation_failed' && error.fields) response.fields = [...error.fields];
    return response;
  }

  const response: ErrorResponse = { code: 'internal', message: SAFE_MESSAGES.internal };
  if (correlationId !== undefined) response.correlationId = correlationId;
  return response;
}

/** The HTTP status for any thrown value. Unrecognized throws are 500. */
export function toHttpStatus(error: unknown): number {
  return error instanceof AppError ? error.httpStatus : 500;
}
