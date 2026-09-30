import {
  buildToken,
  canInWorkspace,
  generateTokenSecret,
  hashSecret,
  parseToken,
  syncTokenSubject,
  verifySecret,
  withAuditedTransaction,
} from '@youandfriends/authz';
import {
  fieldErrorsFromZod,
  forbidden,
  isUlid,
  issueSyncTokenSchema,
  newUlid,
  validationFailed,
  type IssueSyncTokenRequest,
  type WorkspaceId,
} from '@youandfriends/contracts';
import {
  permissionGrants,
  projects,
  syncDevices,
  syncTokens,
  users,
  type DirectDatabase,
} from '@youandfriends/db';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import type { LibraryContext } from '@/lib/library/context';

/**
 * Pairing and managing Mac sync devices (task `110`, ADR 0005, `docs/THREAT_MODEL.md` T7).
 *
 * - The token is **shown once**: {@link issueSyncToken} returns it and nothing stores it — only a
 *   slow hash of its secret. There is no way to read it again, by design.
 * - A device may upload only where its pairer may edit, into the projects chosen at pairing; the
 *   authorizer enforces that on every request (`packages/authz/src/sync-token.ts`).
 * - Revoking works on the next request: nothing remembers a token's validity between requests.
 * - Issuing, first use in each hour, and revoking are audited. The token never is.
 */

const TOKEN_KIND = 'sync';
const DAY_MS = 24 * 60 * 60 * 1000;
/** How often a device's use is audited: that it is in use, not every request it makes. */
const USE_AUDIT_INTERVAL_MS = 60 * 60 * 1000;

/**
 * A hash no secret matches, verified against when a token id is unknown — so an unknown id takes
 * as long to refuse as a wrong secret, and timing says nothing about which ids exist.
 */
const DECOY_HASH = hashSecret(generateTokenSecret());

function refuse(detail: string): never {
  throw forbidden({ detail });
}

function auditContextOf(context: LibraryContext) {
  return {
    workspaceId: context.workspaceId,
    actor: context.subject,
    correlationId: context.correlationId,
    now: context.now ?? (() => new Date()),
    newId: context.newId ?? newUlid,
  };
}

export interface IssuedSyncToken {
  readonly deviceId: string;
  /** Shown to the person once. Never stored, never logged. */
  readonly token: string;
  readonly expiresAt: Date | null;
}

export async function issueSyncToken(
  context: LibraryContext,
  input: IssueSyncTokenRequest,
): Promise<IssuedSyncToken> {
  const parsed = issueSyncTokenSchema.safeParse(input);
  if (!parsed.success) throw validationFailed(fieldErrorsFromZod(parsed.error));
  const request = parsed.data;
  // Only a person pairs a device: a token cannot mint another.
  if (context.subject.kind !== 'member') refuse('only a member may pair a device');
  for (const projectId of request.projectIds) {
    await context.authz.assertCan(context.subject, 'edit', {
      workspaceId: context.workspaceId,
      scopeType: 'project',
      scopeId: projectId,
    });
  }
  const live = await context.db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, context.workspaceId),
        inArray(projects.id, request.projectIds),
        isNull(projects.deletedAt),
      ),
    );
  if (live.length !== request.projectIds.length) refuse('a destination project is not live');

  const newId = context.newId ?? newUlid;
  const now = (context.now ?? (() => new Date()))();
  const deviceId = newId();
  const tokenId = newId();
  const secret = generateTokenSecret();
  const expiresAt =
    request.expiresInDays === null
      ? null
      : new Date(now.getTime() + request.expiresInDays * DAY_MS);

  await withAuditedTransaction(context.db, auditContextOf(context), async ({ tx, audit }) => {
    await tx.insert(syncDevices).values({
      id: deviceId,
      workspaceId: context.workspaceId,
      name: request.name,
      createdBy: context.userId,
      createdAt: now,
    });
    await tx.insert(syncTokens).values({
      id: tokenId,
      workspaceId: context.workspaceId,
      deviceId,
      secretHash: hashSecret(secret),
      createdBy: context.userId,
      expiresAt,
      createdAt: now,
    });
    await tx.insert(permissionGrants).values(
      request.projectIds.map((projectId) => ({
        id: newId(),
        workspaceId: context.workspaceId,
        scopeType: 'project' as const,
        scopeId: projectId,
        subjectKind: 'sync_token' as const,
        subjectId: tokenId,
        role: 'editor' as const,
        canDownload: false,
        canInvite: false,
        createdByUserId: context.userId,
      })),
    );
    await audit({
      action: 'sync_token.issued',
      targetType: 'sync_token',
      targetId: tokenId,
      // Ids and counts. Never the token, never a hash.
      metadata: {
        deviceId,
        destinations: request.projectIds.length,
        expiresAt: expiresAt?.toISOString() ?? null,
      },
    });
  });

  return { deviceId, token: buildToken(TOKEN_KIND, tokenId, secret), expiresAt };
}

export interface DeviceView {
  readonly id: string;
  readonly name: string;
  readonly pairedBy: string | null;
  readonly mine: boolean;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  /** Where it may upload — the projects its pairer can still see named, the rest counted. */
  readonly destinations: readonly { readonly projectId: string; readonly name: string }[];
}

/** The devices this person paired — or, for an owner, every device in the workspace. */
export async function listDevices(context: LibraryContext): Promise<readonly DeviceView[]> {
  if (context.subject.kind !== 'member') refuse('only a member may list devices');
  const everyone = await canInWorkspace(
    context.db,
    context.subject,
    'manage_members',
    context.workspaceId,
  );
  const devices = await context.db
    .select({
      id: syncDevices.id,
      name: syncDevices.name,
      createdBy: syncDevices.createdBy,
      pairedBy: users.displayName,
      createdAt: syncDevices.createdAt,
      revokedAt: syncDevices.revokedAt,
    })
    .from(syncDevices)
    .leftJoin(users, eq(users.id, syncDevices.createdBy))
    .where(
      and(
        eq(syncDevices.workspaceId, context.workspaceId),
        everyone ? undefined : eq(syncDevices.createdBy, context.userId),
      ),
    )
    .orderBy(desc(syncDevices.createdAt));
  if (devices.length === 0) return [];
  // Never the hash: only the columns a list shows.
  const tokens = await context.db
    .select({
      id: syncTokens.id,
      deviceId: syncTokens.deviceId,
      lastUsedAt: syncTokens.lastUsedAt,
      expiresAt: syncTokens.expiresAt,
    })
    .from(syncTokens)
    .where(
      and(
        eq(syncTokens.workspaceId, context.workspaceId),
        inArray(
          syncTokens.deviceId,
          devices.map((device) => device.id),
        ),
      ),
    );
  const grants =
    tokens.length === 0
      ? []
      : await context.db
          .select({
            tokenId: permissionGrants.subjectId,
            projectId: projects.id,
            name: projects.name,
          })
          .from(permissionGrants)
          .innerJoin(
            projects,
            and(
              eq(projects.id, permissionGrants.scopeId),
              eq(projects.workspaceId, permissionGrants.workspaceId),
            ),
          )
          .where(
            and(
              eq(permissionGrants.workspaceId, context.workspaceId),
              eq(permissionGrants.subjectKind, 'sync_token'),
              inArray(
                permissionGrants.subjectId,
                tokens.map((token) => token.id),
              ),
            ),
          );
  return devices.map((device) => {
    const theirs = tokens.filter((token) => token.deviceId === device.id);
    const used = theirs
      .map((token) => token.lastUsedAt)
      .filter((at): at is Date => at !== null)
      .sort((a, b) => b.getTime() - a.getTime());
    return {
      id: device.id,
      name: device.name,
      pairedBy: device.pairedBy,
      mine: device.createdBy === context.userId,
      createdAt: device.createdAt,
      lastUsedAt: used[0] ?? null,
      expiresAt: theirs[0]?.expiresAt ?? null,
      revokedAt: device.revokedAt,
      destinations: grants
        .filter((grant) => theirs.some((token) => token.id === grant.tokenId))
        .map((grant) => ({ projectId: grant.projectId, name: grant.name })),
    };
  });
}

/** Disconnect a device: its pairer, or an owner. Takes effect on the device's next request. */
export async function revokeDevice(context: LibraryContext, deviceId: string): Promise<void> {
  if (context.subject.kind !== 'member') refuse('only a member may revoke a device');
  if (!isUlid(deviceId)) refuse('device id is not a ULID');
  const [device] = await context.db
    .select({
      id: syncDevices.id,
      createdBy: syncDevices.createdBy,
      revokedAt: syncDevices.revokedAt,
    })
    .from(syncDevices)
    .where(and(eq(syncDevices.id, deviceId), eq(syncDevices.workspaceId, context.workspaceId)));
  if (device === undefined) refuse(`no device ${deviceId}`);
  if (
    device.createdBy !== context.userId &&
    !(await canInWorkspace(context.db, context.subject, 'manage_members', context.workspaceId))
  ) {
    refuse(`device ${deviceId} is not theirs`);
  }
  if (device.revokedAt !== null) return;
  const now = (context.now ?? (() => new Date()))();
  await withAuditedTransaction(context.db, auditContextOf(context), async ({ tx, audit }) => {
    await tx
      .update(syncDevices)
      .set({ revokedAt: now, revokedBy: context.userId })
      .where(eq(syncDevices.id, deviceId));
    const revoked = await tx
      .update(syncTokens)
      .set({ revokedAt: now })
      .where(and(eq(syncTokens.deviceId, deviceId), isNull(syncTokens.revokedAt)))
      .returning();
    for (const token of revoked) {
      await audit({
        action: 'sync_token.revoked',
        targetType: 'sync_token',
        targetId: token.id,
        metadata: { deviceId },
      });
    }
  });
}

export interface AuthenticatedDevice {
  readonly tokenId: string;
  readonly workspaceId: WorkspaceId;
  /** Who paired it: the person uploads are made on behalf of. */
  readonly userId: string;
}

/**
 * Who a presented token is, or null: malformed, unknown, wrong secret, revoked, expired, or on a
 * disconnected device — one answer for all of them. Verified in constant time, and against a
 * decoy when the id is unknown, so no path is faster than another.
 */
export async function authenticateSyncToken(
  db: DirectDatabase,
  presented: string,
  now: Date = new Date(),
): Promise<AuthenticatedDevice | null> {
  const parsed = parseToken(TOKEN_KIND, presented);
  if (parsed === null) return null;
  const [row] = await db
    .select({
      id: syncTokens.id,
      workspaceId: syncTokens.workspaceId,
      createdBy: syncTokens.createdBy,
      secretHash: syncTokens.secretHash,
      expiresAt: syncTokens.expiresAt,
      revokedAt: syncTokens.revokedAt,
      useAuditedAt: syncTokens.useAuditedAt,
      deviceRevokedAt: syncDevices.revokedAt,
    })
    .from(syncTokens)
    .innerJoin(
      syncDevices,
      and(
        eq(syncDevices.id, syncTokens.deviceId),
        eq(syncDevices.workspaceId, syncTokens.workspaceId),
      ),
    )
    .where(eq(syncTokens.id, parsed.id));
  const verified = verifySecret(parsed.secret, row?.secretHash ?? DECOY_HASH);
  if (
    row === undefined ||
    !verified ||
    row.revokedAt !== null ||
    row.deviceRevokedAt !== null ||
    (row.expiresAt !== null && row.expiresAt <= now)
  ) {
    return null;
  }
  const workspaceId = row.workspaceId as WorkspaceId;
  // Hourly since the last *audit*, not the last use: a device syncing every ten minutes is still
  // recorded once an hour, not never.
  const auditUse =
    row.useAuditedAt === null ||
    now.getTime() - row.useAuditedAt.getTime() >= USE_AUDIT_INTERVAL_MS;
  if (auditUse) {
    await withAuditedTransaction(
      db,
      { workspaceId, actor: syncTokenSubject(row.id), now: () => now, newId: newUlid },
      async ({ tx, audit }) => {
        await tx
          .update(syncTokens)
          .set({ lastUsedAt: now, useAuditedAt: now })
          .where(eq(syncTokens.id, row.id));
        await audit({ action: 'sync_token.used', targetType: 'sync_token', targetId: row.id });
      },
    );
  } else {
    await db.update(syncTokens).set({ lastUsedAt: now }).where(eq(syncTokens.id, row.id));
  }
  return { tokenId: row.id, workspaceId, userId: row.createdBy };
}
