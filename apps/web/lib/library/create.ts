import { withAuditedTransaction, workspaceRoleOf } from '@youandfriends/authz';
import {
  createProjectSchema,
  createSongSchema,
  fieldErrorsFromZod,
  forbidden,
  isUlid,
  newUlid,
  roleAtLeast,
  validationFailed,
  type CreateProjectRequest,
  type CreateSongRequest,
} from '@youandfriends/contracts';
import { folders, projects, songs } from '@youandfriends/db';
import { and, eq, isNull } from 'drizzle-orm';

import type { LibraryContext } from './context';

/**
 * Creating projects and songs (task `046`).
 *
 * A project lands where the viewer may organize: the root needs editor-or-better on the workspace
 * (the rule `createLibraryFolder` already applies to root folders), a folder needs `edit` on that
 * folder. A song lands in a project the viewer may edit. Every id is untrusted and every refusal
 * is 404-shaped (`docs/THREAT_MODEL.md` T1).
 */

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

function parse<S extends typeof createProjectSchema | typeof createSongSchema>(
  schema: S,
  input: unknown,
) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw validationFailed(fieldErrorsFromZod(parsed.error));
  return parsed.data as ReturnType<S['parse']>;
}

export async function createProject(
  context: LibraryContext,
  input: CreateProjectRequest,
): Promise<{ readonly id: string }> {
  const request = parse(createProjectSchema, input);
  const folderId = request.folderId ?? null;

  if (folderId === null) {
    const role = await workspaceRoleOf(context.db, context.subject, context.workspaceId);
    if (role === null || !roleAtLeast(role, 'editor')) refuse('may not create at the root');
  } else {
    await context.authz.assertCan(context.subject, 'edit', {
      workspaceId: context.workspaceId,
      scopeType: 'folder',
      scopeId: folderId,
    });
    const [folder] = await context.db
      .select({ id: folders.id })
      .from(folders)
      .where(
        and(
          eq(folders.id, folderId),
          eq(folders.workspaceId, context.workspaceId),
          isNull(folders.deletedAt),
        ),
      );
    if (folder === undefined) refuse(`folder ${folderId} is not live`);
  }

  const id = (context.newId ?? newUlid)();
  await withAuditedTransaction(context.db, auditContextOf(context), async ({ tx, audit }) => {
    await tx.insert(projects).values({
      id,
      workspaceId: context.workspaceId,
      folderId,
      name: request.name,
      artist: request.artist ?? null,
    });
    await audit({ action: 'project.created', targetType: 'project', targetId: id });
  });
  return { id };
}

export async function createSong(
  context: LibraryContext,
  projectId: string,
  input: CreateSongRequest,
): Promise<{ readonly id: string }> {
  const request = parse(createSongSchema, input);
  if (!isUlid(projectId)) refuse('project id is not a ULID');
  await context.authz.assertCan(context.subject, 'edit', {
    workspaceId: context.workspaceId,
    scopeType: 'project',
    scopeId: projectId,
  });
  const [project] = await context.db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.workspaceId, context.workspaceId),
        isNull(projects.deletedAt),
      ),
    );
  if (project === undefined) refuse(`project ${projectId} is not live`);

  const id = (context.newId ?? newUlid)();
  await withAuditedTransaction(context.db, auditContextOf(context), async ({ tx, audit }) => {
    await tx.insert(songs).values({
      id,
      workspaceId: context.workspaceId,
      projectId,
      title: request.title,
    });
    // A new song is a change to its project: the project's card moves up the shelf.
    await tx.update(projects).set({ status: projects.status }).where(eq(projects.id, projectId));
    await audit({
      action: 'song.created',
      targetType: 'song',
      targetId: id,
      metadata: { projectId },
    });
  });
  return { id };
}
