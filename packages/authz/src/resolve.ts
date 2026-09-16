import {
  type EffectiveAccess,
  type GrantScope,
  type Role,
  NO_ACCESS,
} from '@youandfriends/contracts';

/**
 * Resolution, as a pure function over a list of grants.
 *
 * This is the whole design, and it is deliberately separated from anything that touches a
 * database: every rule below is exercised by a table of cases rather than by fixtures, and
 * task `023`'s matrix enumerates them exhaustively. A resolution bug that only reproduces
 * with a particular query is a resolution bug nobody can reason about.
 *
 * The rule is **most-specific-wins, evaluated independently per facet**. Role, download, and
 * invite each walk the chain from the target outwards and stop at the first level that says
 * something. That is what makes a viewer-with-download and an editor-without-download both
 * expressible (`docs/DESIGN.md` §3) — a single winning grant would force them to move
 * together.
 *
 * A deny is not a fourth facet. It is a grant that says "nothing, here", so it wins at its
 * level exactly like an allow would, and a *more specific* allow still beats it. That is what
 * "an explicit deny at a child overrides an inherited allow" means, read carefully: the deny
 * overrides what is *less* specific than itself, never what is more.
 */

/** One link in the chain from a target outwards. Lower `specificity` is further away. */
export interface ChainLink {
  readonly scopeType: GrantScope;
  readonly scopeId: string;
  /** Higher wins. The target itself is highest; the workspace baseline is 0. */
  readonly specificity: number;
}

/** A grant as resolution needs it — the database columns, with time already decided. */
export interface ResolvableGrant {
  readonly scopeType: GrantScope;
  readonly scopeId: string;
  readonly role: Role | null;
  readonly canDownload: boolean | null;
  readonly canInvite: boolean | null;
  readonly isDeny: boolean;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
}

/** The workspace-level baseline a member carries, or `null` for a non-member. */
export interface MembershipBaseline {
  readonly role: Role;
  readonly canDownload: boolean;
  readonly canInvite: boolean;
}

export interface ResolveInput {
  /** The scope chain, in any order. */
  readonly chain: readonly ChainLink[];
  /** Every grant held by this subject in this workspace. Filtered against the chain here. */
  readonly grants: readonly ResolvableGrant[];
  /** Null when the subject is not a member, or is a kind that never inherits membership. */
  readonly membership: MembershipBaseline | null;
  /** The moment the decision is being made. Passed in so tests are not clock-dependent. */
  readonly now: Date;
}

/** Whether a grant's active window contains `now`. */
export function isActive(grant: ResolvableGrant, now: Date): boolean {
  if (grant.startsAt !== null && now < grant.startsAt) return false;
  // Exclusive end: a grant "until Friday" is over when Friday's timestamp arrives, not a
  // millisecond later. The alternative leaves an access that nobody can explain.
  if (grant.endsAt !== null && now >= grant.endsAt) return false;
  return true;
}

interface Candidate {
  readonly specificity: number;
  readonly grant: ResolvableGrant;
}

/**
 * Walk one facet outwards and take the first level that speaks.
 *
 * `read` returns `undefined` when a grant is silent about this facet — which is exactly why
 * `canDownload` is nullable in the database. A grant that raises someone to editor on one
 * song should not quietly revoke the download permission they hold on the folder.
 */
function resolveFacet<T>(
  candidates: readonly Candidate[],
  baseline: T | undefined,
  read: (grant: ResolvableGrant) => T | undefined,
  denied: T,
): { value: T | undefined } {
  let best: { specificity: number; value: T; isDeny: boolean } | undefined;

  for (const { specificity, grant } of candidates) {
    // A deny speaks about every facet at once: it says "nothing, here".
    const value = grant.isDeny ? denied : read(grant);
    if (value === undefined) continue;

    if (best === undefined || specificity > best.specificity) {
      best = { specificity, value, isDeny: grant.isDeny };
      continue;
    }

    // A tie should be impossible: a unique index allows one grant per subject per scope. If
    // that index were ever dropped, the outcome would otherwise depend on row order, so the
    // deny is taken — the safer answer is the one that falls out of the tie, not the one
    // that happens to be read second.
    if (specificity === best.specificity && grant.isDeny && !best.isDeny) {
      best = { specificity, value, isDeny: true };
    }
  }

  // Wrapped, not unwrapped. A deny resolves role to `null` deliberately, and returning that
  // bare would let `?? baseline` at the call site restore the membership role the deny was
  // written to remove — silently, and only for members, which is almost everyone.
  // Any grant on the chain outranks the workspace baseline, so a grant that spoke wins.
  return { value: best === undefined ? baseline : best.value };
}

/**
 * Effective access for a subject on a target.
 *
 * Deny by default: with no grants and no membership the answer is `NO_ACCESS`, so a resource
 * class nobody has wired up is unreachable rather than accidentally public (ADR 0006).
 */
export function resolve(input: ResolveInput): EffectiveAccess {
  const { chain, grants, membership, now } = input;

  const specificityOf = new Map<string, number>();
  for (const link of chain) {
    specificityOf.set(`${link.scopeType}:${link.scopeId}`, link.specificity);
  }

  const candidates: Candidate[] = [];
  for (const grant of grants) {
    const specificity = specificityOf.get(`${grant.scopeType}:${grant.scopeId}`);
    // A grant on a scope outside this target's chain is a grant on something else.
    if (specificity === undefined) continue;
    if (!isActive(grant, now)) continue;
    candidates.push({ specificity, grant });
  }

  if (candidates.length === 0 && membership === null) return NO_ACCESS;

  const role = resolveFacet<Role | null>(
    candidates,
    membership?.role,
    (grant) => grant.role ?? undefined,
    null,
  );

  const canDownload = resolveFacet<boolean>(
    candidates,
    membership?.canDownload,
    (grant) => grant.canDownload ?? undefined,
    false,
  );

  const canInvite = resolveFacet<boolean>(
    candidates,
    membership?.canInvite,
    (grant) => grant.canInvite ?? undefined,
    false,
  );

  const resolvedRole = role.value ?? null;

  return {
    role: resolvedRole,
    // A capability without a role is meaningless: there is nothing to download or invite to.
    // Without this, a stale download grant would survive a role deny as a bare `true`.
    canDownload: resolvedRole === null ? false : (canDownload.value ?? false),
    canInvite: resolvedRole === null ? false : (canInvite.value ?? false),
  } satisfies EffectiveAccess;
}
