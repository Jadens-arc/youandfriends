/**
 * `@youandfriends/authz`
 *
 * The single source of permission truth (ADR 0006). No route handler, server action, or
 * component performs a role comparison; a lint rule enforces that mechanically, because a
 * rule maintained by discipline is a rule that survives until the first hurried afternoon.
 *
 * The surface is deliberately small:
 *
 *   createAuthorizer(db)                          one per request, never shared
 *     .resolveAccess(subject, target)             effective role and capabilities
 *     .assertCan(subject, action, target)         throws 404-shaped on refusal
 *     .can(subject, action, target)               the same decision as a boolean
 *   scopedQuery(db, subject, workspaceId)         a handle that cannot read another tenant
 *
 * `resolve` is exported separately as a pure function so the rules can be tested exhaustively
 * without a database — task `023` enumerates the matrix over it.
 */

/** Package identifier, used to confirm the workspace graph resolves correctly. */
export const PACKAGE_NAME = '@youandfriends/authz' as const;

export {
  createAuthorizer,
  permits,
  type Authorizer,
  type AuthorizerOptions,
  type DecisionSink,
} from './authorizer';
export {
  auditClassOf,
  auditDecisions,
  safeMetadata,
  withAuditedTransaction,
  type AuditContext,
  type AuditedTransaction,
  type AuditEmitter,
  type AuditEntry,
} from './audit';
export {
  assertWorkspaceOwner,
  queryAuditEvents,
  MAX_AUDIT_PAGE,
  type AuditQuery,
} from './audit-query';
export { buildChain, foldersInPath, type ChainInput } from './chain';
export { assertCanInWorkspace, canInWorkspace, workspaceRoleOf } from './workspace';
export {
  deleteEntity,
  restoreEntity,
  runPurge,
  type LifecycleContext,
  type PurgeRun,
  type PurgeRunOptions,
} from './lifecycle';
export {
  isActive,
  resolve,
  type ChainLink,
  type MembershipBaseline,
  type ResolvableGrant,
  type ResolveInput,
} from './resolve';
export {
  scopedQuery,
  SCOPED_TABLES,
  type Lifecycle,
  type ScopedDb,
  type ScopedOptions,
  type ScopedTable,
} from './scoped-query';
export {
  anonymous,
  inheritsMembership,
  memberSubject,
  shareLinkSubject,
  subjectId,
  syncTokenSubject,
  type AnonymousSubject,
  type MemberSubject,
  type ShareLinkSubject,
  type Subject,
  type SyncTokenSubject,
  type Target,
} from './subjects';
export { loadChain } from './target';
