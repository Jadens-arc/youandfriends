import 'server-only';

import { loggerForEnv, parseServerEnv } from '@youandfriends/config';
import {
  AppError,
  fieldErrorsFromZod,
  newUlid,
  toErrorResponse,
  toHttpStatus,
  ulidSchema,
  unauthorized,
  validationFailed,
  type ErrorResponse,
} from '@youandfriends/contracts';
import type { z } from 'zod';

import { currentWorkspace, type WorkspaceContext } from '@/lib/workspace/current';

/**
 * The shared shape of a JSON route handler.
 *
 * Every API route in the product does the same five things in the same order, and the order is
 * the security property: parse and validate the body with Zod **before** anything touches the
 * database or storage; resolve who is asking; do the work through a service that owns the
 * authorization; map every refusal to a status that does not confirm existence
 * (`docs/THREAT_MODEL.md` T1); and log the failure under a correlation id the client also sees,
 * without ever putting internals in the response.
 */

export function correlationIdOf(request: Request): string {
  // The platform's own id when there is one, so these logs join Vercel's; otherwise our own.
  return request.headers.get('x-vercel-id') ?? newUlid();
}

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Every API response here is per-user; none may be stored by a shared cache.
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export function errorJson(
  status: number,
  body: ErrorResponse,
  headers: HeadersInit = {},
): Response {
  return json(body, status, headers);
}

/** Read a JSON body and validate it, or throw a `validation_failed` naming the bad fields. */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw validationFailed([{ path: '', message: 'Body must be JSON.' }]);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw validationFailed(fieldErrorsFromZod(parsed.error));
  return parsed.data;
}

/** A path id, shape-checked. A malformed id is `not_found`, exactly like an unknown one. */
export function parsePathId(value: string): string {
  const parsed = ulidSchema.safeParse(value);
  if (!parsed.success) throw new AppError('not_found', { detail: 'path id is not a ULID' });
  return parsed.data;
}

/** The signed-in person and their workspace, or `unauthorized`. */
export async function requireWorkspace(): Promise<WorkspaceContext> {
  const context = await currentWorkspace();
  if (context === null) throw unauthorized({ detail: 'no session or no resolvable workspace' });
  return context;
}

/**
 * Run a handler and turn whatever it throws into a response.
 *
 * `mapError` lets a route translate its own service's error type first — the upload service has
 * `UploadError`, for instance — and falls through to `AppError`'s own mapping, then to a bare
 * 500 that carries nothing but the correlation id.
 */
export async function handleJson(
  request: Request,
  run: (correlationId: string) => Promise<Response>,
  mapError?: (error: unknown, correlationId: string) => Response | null,
): Promise<Response> {
  const correlationId = correlationIdOf(request);
  try {
    return await run(correlationId);
  } catch (error) {
    const mapped = mapError?.(error, correlationId) ?? null;
    if (mapped !== null) return mapped;

    const status = toHttpStatus(error);
    if (status >= 500) {
      loggerForEnv(parseServerEnv()).error('api request failed', {
        error,
        correlationId,
        route: new URL(request.url).pathname,
      });
    }
    return errorJson(status, toErrorResponse(error, correlationId));
  }
}
