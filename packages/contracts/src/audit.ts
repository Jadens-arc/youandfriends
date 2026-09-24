/**
 * The audit vocabulary.
 *
 * `docs/DESIGN.md` §13 names ten classes of action that must be recorded: authentication,
 * access, sharing, permission changes, uploads, edits, downloads, deletion, restoration, and
 * administrative actions. Those classes are the contract; the individual actions below are
 * how they are spelled.
 *
 * The whole vocabulary is defined now, before most of the subsystems that emit it exist,
 * because an audit log that grows its vocabulary alongside its features ends up with ten
 * spellings of "deleted" and no way to ask a question across them. A test asserts every class
 * has at least one action, and that every action names the task that wires its emission —
 * so an unwired action is visible rather than merely absent.
 */

import { z } from 'zod';

/** The ten classes from `docs/DESIGN.md` §13. This list is the contract. */
export const AUDIT_CLASSES = [
  'authentication',
  'access',
  'sharing',
  'permission',
  'upload',
  'edit',
  'download',
  'deletion',
  'restoration',
  'administration',
] as const;

export const auditClassSchema = z.enum(AUDIT_CLASSES);
export type AuditClass = z.infer<typeof auditClassSchema>;

export const AUDIT_ACTIONS = [
  'auth.signed_in',
  'auth.signed_out',
  'auth.session_revoked',

  'access.granted',
  'access.denied',

  'share.link_created',
  'share.link_revoked',
  'share.link_accessed',

  'permission.granted',
  'permission.revoked',
  'permission.changed',

  'upload.started',
  'upload.completed',
  'upload.aborted',
  'version.created',
  'version.processing_retried',

  'song.created',
  'song.updated',
  'project.created',
  'project.updated',
  'folder.updated',
  'folder.moved',
  'lyrics.updated',
  'comment.created',
  'asset.updated',

  'asset.downloaded',
  'version.downloaded',

  'song.deleted',
  'project.deleted',
  'folder.deleted',
  'asset.deleted',
  'snapshot.deleted',
  'comment.deleted',

  'song.restored',
  'project.restored',
  'folder.restored',
  'asset.restored',
  'snapshot.restored',
  'lyrics.revision_restored',

  'invitation.created',
  'invitation.accepted',
  'invitation.revoked',
  'member.added',
  'member.removed',
  'member.role_changed',
  'workspace.created',
  'workspace.settings_changed',
  'sync_token.issued',
  'sync_token.revoked',
] as const;

export const auditActionSchema = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof auditActionSchema>;

/**
 * Which class each action belongs to, and which task wires its emission.
 *
 * `emittedBy` is not decoration: an action with no emitter yet is a gap, and naming the task
 * makes the gap visible in one place rather than discoverable only by grepping. Task `023`
 * uses the same pattern for resource classes, and for the same reason.
 */
export const AUDIT_ACTION_INFO: Readonly<
  Record<AuditAction, { readonly class: AuditClass; readonly emittedBy: string }>
> = {
  // Moved from `030`, which had no workspace to attribute them to (`audit_events.workspace_id`
  // is `NOT NULL`). Written from Clerk's session webhooks — the server never sees a sign-out
  // any other way.
  'auth.signed_in': { class: 'authentication', emittedBy: '031' },
  'auth.signed_out': { class: 'authentication', emittedBy: '031' },
  'auth.session_revoked': { class: 'authentication', emittedBy: '031' },

  'access.granted': { class: 'access', emittedBy: '024' },
  'access.denied': { class: 'access', emittedBy: '024' },

  'share.link_created': { class: 'sharing', emittedBy: '200' },
  'share.link_revoked': { class: 'sharing', emittedBy: '200' },
  'share.link_accessed': { class: 'sharing', emittedBy: '200' },

  // `024` built the log and `auditDecisions` (access.granted/denied only); nothing wrote a
  // `permission_grants` row until `032`'s invitation acceptance, role change, and removal did.
  'permission.granted': { class: 'permission', emittedBy: '032' },
  'permission.revoked': { class: 'permission', emittedBy: '032' },
  'permission.changed': { class: 'permission', emittedBy: '032' },

  // An invitation is pending access, not yet a grant — its own class and its own target, so
  // "who was invited and by whom" survives independently of whether it was ever accepted.
  'invitation.created': { class: 'permission', emittedBy: '032' },
  'invitation.accepted': { class: 'permission', emittedBy: '032' },
  'invitation.revoked': { class: 'permission', emittedBy: '032' },

  'upload.started': { class: 'upload', emittedBy: '051' },
  'upload.completed': { class: 'upload', emittedBy: '051' },
  'upload.aborted': { class: 'upload', emittedBy: '051' },
  'version.created': { class: 'upload', emittedBy: '056' },
  'version.processing_retried': { class: 'edit', emittedBy: '065' },

  'song.created': { class: 'edit', emittedBy: '046' },
  'song.updated': { class: 'edit', emittedBy: '044' },
  'project.created': { class: 'edit', emittedBy: '046' },
  'project.updated': { class: 'edit', emittedBy: '044' },
  'folder.updated': { class: 'edit', emittedBy: '040' },
  'folder.moved': { class: 'edit', emittedBy: '040' },
  'lyrics.updated': { class: 'edit', emittedBy: '081' },
  'comment.created': { class: 'edit', emittedBy: '090' },
  // Renaming, moving, and tagging a file in Project Files.
  'asset.updated': { class: 'edit', emittedBy: '057' },

  'asset.downloaded': { class: 'download', emittedBy: '058' },
  'version.downloaded': { class: 'download', emittedBy: '056' },

  'song.deleted': { class: 'deletion', emittedBy: '025' },
  'project.deleted': { class: 'deletion', emittedBy: '025' },
  'folder.deleted': { class: 'deletion', emittedBy: '025' },
  'asset.deleted': { class: 'deletion', emittedBy: '028' },
  'snapshot.deleted': { class: 'deletion', emittedBy: '028' },
  'comment.deleted': { class: 'deletion', emittedBy: '090' },

  'song.restored': { class: 'restoration', emittedBy: '025' },
  'project.restored': { class: 'restoration', emittedBy: '025' },
  'asset.restored': { class: 'restoration', emittedBy: '028' },
  'snapshot.restored': { class: 'restoration', emittedBy: '028' },
  'folder.restored': { class: 'restoration', emittedBy: '025' },
  'lyrics.revision_restored': { class: 'restoration', emittedBy: '083' },

  'member.added': { class: 'administration', emittedBy: '032' },
  'member.removed': { class: 'administration', emittedBy: '032' },
  'member.role_changed': { class: 'administration', emittedBy: '032' },
  'workspace.created': { class: 'administration', emittedBy: '031' },
  'workspace.settings_changed': { class: 'administration', emittedBy: '031' },
  'sync_token.issued': { class: 'administration', emittedBy: '110' },
  'sync_token.revoked': { class: 'administration', emittedBy: '110' },
};

/** What an audit event points at. Wider than a grant scope: auth events target a session. */
export const AUDIT_TARGET_TYPES = [
  'workspace',
  'folder',
  'project',
  'song',
  'asset',
  'snapshot',
  'version',
  'lyrics',
  'comment',
  'member',
  'permission_grant',
  'invitation',
  'share_link',
  'sync_token',
  'session',
  'upload_session',
] as const;

export const auditTargetTypeSchema = z.enum(AUDIT_TARGET_TYPES);
export type AuditTargetType = z.infer<typeof auditTargetTypeSchema>;

/** Actions belonging to one class. */
export function actionsInClass(auditClass: AuditClass): AuditAction[] {
  return AUDIT_ACTIONS.filter((action) => AUDIT_ACTION_INFO[action].class === auditClass);
}
