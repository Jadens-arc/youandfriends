import { z } from 'zod';

import { ulidSchema } from './ids';

/**
 * Sync tokens for the Mac agent (task `110`, ADR 0005).
 *
 * A token can do **one** thing: add uploads to Project Files, in the projects it names, in one
 * workspace. That is what `SYNC_TOKEN_ACTIONS` says, and `packages/authz` refuses everything else
 * for a sync-token subject, whatever its grants would otherwise permit.
 */
export const SYNC_TOKEN_ACTIONS = ['edit'] as const;

/** Enough destinations for a studio; not a way to hand one device the whole library. */
export const MAX_SYNC_DESTINATIONS = 20;

export const SYNC_TOKEN_LIFETIMES_DAYS = [30, 90, 365] as const;

export const issueSyncTokenSchema = z.object({
  /** What the device is called in the list: "Studio iMac". */
  name: z.string().trim().min(1, 'Name the device.').max(80),
  projectIds: z
    .array(ulidSchema)
    .min(1, 'Choose where this device may upload.')
    .max(MAX_SYNC_DESTINATIONS)
    .refine((ids) => new Set(ids).size === ids.length, 'A project is listed twice.'),
  /** Days until it stops working; `null` for never (revocation is always available). */
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365), z.null()]).default(90),
});
export type IssueSyncTokenRequest = z.input<typeof issueSyncTokenSchema>;
