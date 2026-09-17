import {
  AUDIT_ACTION_INFO,
  newUlid,
  type AuditAction,
  type AuditTargetType,
  type WorkspaceId,
} from '@youandfriends/contracts';
import { redact } from '@youandfriends/config';
import {
  auditEvents,
  withTransaction,
  type DirectDatabase,
  type Transaction,
} from '@youandfriends/db';

import { subjectId, type Subject } from './subjects';

/**
 * The audit log's write path.
 *
 * ADR 0006: an access-changing action writes its audit event **atomically with the change**.
 * An audit write that can fail on its own produces a log that is silently incomplete, which
 * is worse than no log — nobody doubts it during the investigation it exists for.
 *
 * That is why there is no bare `recordAuditEvent(db, …)`. The only way in is
 * {@link withAuditedTransaction}, which hands the caller a transaction and an emitter already
 * bound to it. Forgetting to use the same transaction is not a mistake that can be made;
 * there is no other transaction on offer.
 */

/** Everything an audit row records beyond the actor and the moment. */
export interface AuditEntry {
  readonly action: AuditAction;
  readonly targetType: AuditTargetType;
  readonly targetId?: string | undefined;
  /** Arbitrary detail. Redacted on the way in — see {@link safeMetadata}. */
  readonly metadata?: Record<string, unknown> | undefined;
}

/** Who is acting, where, and under which request. */
export interface AuditContext {
  readonly workspaceId: WorkspaceId;
  readonly actor: Subject;
  /** Joins this row to the structured logs for the same request. */
  readonly correlationId?: string | undefined;
  /** Injected so tests are not clock-dependent. */
  readonly now?: () => Date;
  /** Injected so tests need no ULID dependency. Defaults to a sortable random id. */
  readonly newId?: () => string;
}

/** Emits an event into the transaction it was created for. */
export type AuditEmitter = (entry: AuditEntry) => Promise<void>;

/**
 * Redact metadata **at write time**, not at serialization.
 *
 * A presigned URL or a password verifier that reaches this column is in the durable record;
 * redacting on the way out would leave it sitting there, in the one table designed never to
 * be edited. `docs/THREAT_MODEL.md` T3 and the task `002` deny-list both apply here, and an
 * audit log that records credentials is a high-value target rather than a control.
 */
export function safeMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (metadata === undefined) return {};
  const redacted = redact(metadata);
  // `redact` returns `unknown`; anything that is not a plain object would be a caller error,
  // and dropping it is safer than storing something unexamined.
  return typeof redacted === 'object' && redacted !== null && !Array.isArray(redacted)
    ? (redacted as Record<string, unknown>)
    : {};
}

/** The handle a caller works with: the transaction, and an emitter bound to it. */
export interface AuditedTransaction {
  readonly tx: Transaction;
  readonly audit: AuditEmitter;
}

/**
 * Run an action and its audit events in one transaction.
 *
 * If the action throws, the transaction rolls back and the events go with it — a rolled-back
 * action leaves no trace, which is the honest outcome. It also means an event cannot be
 * written for something that did not happen.
 */
export async function withAuditedTransaction<T>(
  db: DirectDatabase,
  context: AuditContext,
  run: (handle: AuditedTransaction) => Promise<T>,
): Promise<T> {
  const now = context.now ?? (() => new Date());
  const newId = context.newId ?? newUlid;

  return withTransaction(db, async (tx) => {
    const audit: AuditEmitter = async (entry) => {
      await tx.insert(auditEvents).values({
        id: newId(),
        workspaceId: context.workspaceId,
        actorKind: context.actor.kind,
        // Anonymous has no id by construction, which is itself worth recording.
        actorId: subjectId(context.actor),
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        metadata: safeMetadata(entry.metadata),
        correlationId: context.correlationId ?? null,
        occurredAt: now(),
      });
    };

    return run({ tx, audit });
  });
}

/**
 * The id generator, exported for its own tests only.
 *
 * Not part of the package's surface: callers get ids by emitting events. Named so that an
 * import of it outside a test reads as the mistake it would be. It re-exports
 * `newUlid` from `contracts`, which is where the generator lives now — three copies of a
 * Crockford alphabet is three chances to get its width or its characters wrong.
 */
export const auditIdForTests = newUlid;

/** The class an action belongs to. Exported so callers need not reach into the contract map. */
export function auditClassOf(action: AuditAction): string {
  return AUDIT_ACTION_INFO[action].class;
}

/**
 * A {@link DecisionSink} that records access decisions into an open audited transaction.
 *
 * Access events are the one class this package emits itself; every other class belongs to the
 * task that performs the action. Wire it where a decision is worth a record — a refusal on a
 * sensitive read, an escalation — rather than on every check, because a permission check runs
 * on every read in the product and an audit row per check would drown the log it is meant to
 * make readable.
 */
export function auditDecisions(audit: AuditEmitter, options: { onlyRefusals?: boolean } = {}) {
  return async (decision: {
    readonly target: { scopeType: string; scopeId: string };
    readonly action: string | null;
    readonly allowed: boolean;
  }): Promise<void> => {
    if (options.onlyRefusals === true && decision.allowed) return;

    // Awaited, not fired and forgotten. A dropped audit write is the silently-incomplete log
    // ADR 0006 rules out: the failure would be invisible and the record trusted anyway.
    await audit({
      action: decision.allowed ? 'access.granted' : 'access.denied',
      targetType: decision.target.scopeType as AuditEntry['targetType'],
      targetId: decision.target.scopeId,
      metadata: { attemptedAction: decision.action },
    });
  };
}
