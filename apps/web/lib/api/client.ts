/**
 * The browser's side of the JSON routes: POST a body, and turn a refusal into an `Error` whose
 * message is the server's safe sentence (never internals — see `packages/contracts/src/errors.ts`)
 * with any field errors attached for the form that sent it.
 */
export class RequestFailed extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields: readonly { readonly path: string; readonly message: string }[] = [],
  ) {
    super(message);
    this.name = 'RequestFailed';
  }
}

export async function postJson<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new RequestFailed('You appear to be offline. Try again when you’re connected.', 0);
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      message?: string;
      fields?: { path: string; message: string }[];
    };
    throw new RequestFailed(
      payload.fields?.[0]?.message ?? payload.message ?? 'Something went wrong. Try again.',
      response.status,
      payload.fields ?? [],
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
