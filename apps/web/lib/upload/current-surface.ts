import * as React from 'react';

import type { UploadSurface } from '@/components/upload/upload-dialog';

/**
 * The upload destination on screen right now (task `045`), so the command palette can offer
 * "Upload files to Night Drive" wherever that page would accept a drop. A page registers its
 * surface by rendering a `DropZone` — which it does only for people who may upload there — so
 * the palette never offers an upload the page itself would not.
 */
let current: UploadSurface | null = null;
const listeners = new Set<() => void>();

function publish(next: UploadSurface | null) {
  current = next;
  for (const listener of listeners) listener();
}

export function useRegisterUploadSurface(surface: UploadSurface): void {
  const { type, id, name } = surface;
  React.useEffect(() => {
    const registered = { type, id, name } as UploadSurface;
    publish(registered);
    return () => {
      if (current === registered) publish(null);
    };
  }, [type, id, name]);
}

export function useCurrentUploadSurface(): UploadSurface | null {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );
}
