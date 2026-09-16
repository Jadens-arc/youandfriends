import { type SubjectKind, type UserId, type WorkspaceId } from '@youandfriends/contracts';

/**
 * Who is asking.
 *
 * The union is defined in full now, before three of the four can occur, because resolution
 * reads the *kind* at every level. Adding a subject later would mean revisiting every branch
 * that assumed there was only one — and the branch most likely to be missed is the one that
 * decides whether a subject gets workspace-membership baseline access. A share-link bearer
 * must never inherit that, and it is easier to state once than to remember.
 */

/** A signed-in person with a workspace membership. */
export interface MemberSubject {
  readonly kind: Extract<SubjectKind, 'member'>;
  readonly userId: UserId;
}

/** A Mac sync agent's token (task `110`). Scoped to what the token was issued for. */
export interface SyncTokenSubject {
  readonly kind: Extract<SubjectKind, 'sync_token'>;
  readonly tokenId: string;
}

/** Someone holding a share link (deferred task `200`). Never a member. */
export interface ShareLinkSubject {
  readonly kind: Extract<SubjectKind, 'share_link'>;
  readonly linkId: string;
}

/** Nobody. Present so "signed out" is a value rather than a null check. */
export interface AnonymousSubject {
  readonly kind: Extract<SubjectKind, 'anonymous'>;
}

export type Subject = MemberSubject | SyncTokenSubject | ShareLinkSubject | AnonymousSubject;

export const anonymous: AnonymousSubject = { kind: 'anonymous' };

export const memberSubject = (userId: UserId): MemberSubject => ({ kind: 'member', userId });

export const syncTokenSubject = (tokenId: string): SyncTokenSubject => ({
  kind: 'sync_token',
  tokenId,
});

export const shareLinkSubject = (linkId: string): ShareLinkSubject => ({
  kind: 'share_link',
  linkId,
});

/**
 * The id a grant's `subject_id` column holds for this subject, or `null` for anonymous.
 *
 * Anonymous has no id by construction, which is why it can never match a grant — and why
 * deny-by-default is not a policy applied to it but a fact about it.
 */
export function subjectId(subject: Subject): string | null {
  switch (subject.kind) {
    case 'member':
      return subject.userId;
    case 'sync_token':
      return subject.tokenId;
    case 'share_link':
      return subject.linkId;
    case 'anonymous':
      return null;
  }
}

/**
 * Whether this subject may inherit the workspace-membership baseline.
 *
 * Only a member. A share-link bearer holding a link to one song must not thereby see the
 * workspace — that is the whole point of a share link, and conflating the two would turn
 * every shared song into a workspace invitation (`docs/THREAT_MODEL.md` T5).
 */
export function inheritsMembership(subject: Subject): subject is MemberSubject {
  return subject.kind === 'member';
}

/** A target a decision can be made about. */
export interface Target {
  readonly workspaceId: WorkspaceId;
  readonly scopeType: 'folder' | 'project' | 'song';
  readonly scopeId: string;
}
