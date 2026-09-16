import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@youandfriends/contracts';
import { index, jsonb, pgEnum, pgTable, text } from 'drizzle-orm/pg-core';

import { createdAt, id, reference, workspaceId } from './columns';
import { subjectKindEnum } from './permissions';
import { workspaces } from './workspaces';

export const auditActionEnum = pgEnum('audit_action', AUDIT_ACTIONS);
export const auditTargetTypeEnum = pgEnum('audit_target_type', AUDIT_TARGET_TYPES);

/**
 * The audit log. Append-only, and written in the same transaction as the thing it records.
 *
 * An audit write that can fail independently of the action produces a log that is silently
 * incomplete — which is worse than no log, because it is trusted. Emission therefore goes
 * through `withAuditedTransaction` in `packages/authz`, which hands the caller a transaction
 * and an emitter bound to it; there is no way to write one outside a transaction.
 *
 * **Append-only is enforced by the database.** A trigger rejects every `UPDATE` and `DELETE`,
 * so a bug, a migration, or somebody at a `psql` prompt cannot quietly rewrite history. A
 * dedicated role without those privileges would be stronger still, but it would mean a second
 * connection string in every deployment; the trigger holds for every caller, including the
 * owner role, which is the property that actually matters here.
 *
 * There is no `updated_at`. A row that can be updated is not append-only, and a column
 * inviting it would be a standing suggestion.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: id(),
    /**
     * No cascade. Deleting a workspace is refused while its audit events exist, because a
     * cascade would silently destroy the record as a side effect of another action — and a
     * `DELETE` issued by a cascade fires the append-only trigger anyway, so the delete would
     * fail confusingly rather than cleanly. Purging a tenant's history is a deliberate,
     * documented retention procedure (`docs/DESIGN.md` §13), not a consequence.
     */
    workspaceId: workspaceId().references(() => workspaces.id),

    /**
     * Who acted, and as what. "Who" is not always a user: a sync upload attributed to a bare
     * user id loses the device it came from, which is exactly what an investigation needs.
     */
    actorKind: subjectKindEnum('actor_kind').notNull(),
    /** Null only for an anonymous actor, which by construction has no id. */
    actorId: reference('actor_id'),

    action: auditActionEnum('action').notNull(),
    targetType: auditTargetTypeEnum('target_type').notNull(),
    targetId: reference('target_id'),

    /**
     * Redacted at write time, not at serialization. A secret that reaches this column is in
     * the durable record; redacting on the way out would leave it there.
     */
    metadata: jsonb('metadata').notNull().default({}),

    /** Joins an audit row to the structured logs for the same request. */
    correlationId: text('correlation_id'),

    occurredAt: createdAt(),
  },
  (table) => [
    // "What happened in this workspace, newest first" — the owner-facing query.
    index('audit_events_workspace_time_idx').on(table.workspaceId, table.occurredAt),
    // "Everything this person did", the second question an investigation asks.
    index('audit_events_actor_idx').on(table.workspaceId, table.actorKind, table.actorId),
    // "Everything that happened to this song."
    index('audit_events_target_idx').on(table.workspaceId, table.targetType, table.targetId),
    index('audit_events_action_idx').on(table.workspaceId, table.action),
  ],
);
