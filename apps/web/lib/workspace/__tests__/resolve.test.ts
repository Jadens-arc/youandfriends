import {
  auditEvents,
  workspaceMemberships,
  workspaces,
  type DirectDatabase,
} from '@youandfriends/db';
import {
  addMember,
  createTestDatabase,
  makeTenant,
  makeUser,
  testId,
  unavailableReason,
  type TestDatabase,
} from '@youandfriends/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { defaultWorkspaceName, ensureWorkspace } from '../provision';
import { maySelectWorkspace, REFUSED_SELECTION_WINDOW_MS, resolveWorkspace } from '../resolve';

const reason = unavailableReason();
const describeWithDatabase = reason === null ? describe : describe.skip;
if (reason !== null) console.warn(`SKIPPING workspace resolution tests: ${reason}`);

/**
 * Which workspace a request works in, and creating one on first sign-in.
 *
 * Rows that make each rule bite (CLAUDE.md §13): a person with **two** memberships, so "honour the
 * request" differs from "take the first"; a **populated foreign workspace** the cookie can name;
 * and a person with **no user-facing workspace at all**, so provisioning has something to do.
 */
describeWithDatabase('resolving the current workspace', () => {
  let database: TestDatabase;
  let db: DirectDatabase;

  beforeAll(async () => {
    database = await createTestDatabase('web_workspace_resolve');
    db = database.db;
  }, 60_000);

  afterAll(async () => {
    await database?.teardown();
  });

  const eventsIn = (workspaceId: string) =>
    db.select().from(auditEvents).where(eq(auditEvents.workspaceId, workspaceId));

  describe('on a first sign-in', () => {
    it('creates a private workspace the person owns, and records it', async () => {
      const user = await makeUser(db);

      const current = await resolveWorkspace(db, {
        userId: user.id,
        displayName: 'Avery Stone',
        requested: null,
      });

      expect(current).toMatchObject({ name: 'Avery Stone’s workspace', role: 'owner' });

      const events = await eventsIn(current?.workspaceId ?? '');
      expect(events.map((event) => [event.action, event.actorId, event.targetId])).toEqual([
        ['workspace.created', user.id, current?.workspaceId],
      ]);
    });

    it('creates one workspace and one record when the first sign-in arrives as a stampede', async () => {
      const user = await makeUser(db);
      const input = { userId: user.id, displayName: 'Avery', requested: null };

      const results = await Promise.all(
        Array.from({ length: 6 }, () => resolveWorkspace(db, input)),
      );

      const ids = new Set(results.map((result) => result?.workspaceId));
      expect(ids.size).toBe(1);
      const owned = await db.select().from(workspaces).where(eq(workspaces.ownerUserId, user.id));
      expect(owned).toHaveLength(1);
      // An event per request would claim six creations of one workspace.
      const created = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.action, 'workspace.created'), eq(auditEvents.actorId, user.id)));
      expect(created).toHaveLength(1);
    });

    it('never names a workspace after an email address', () => {
      // The display name is already never the email (`identityFrom`); this pins the template
      // to it rather than to anything else about the person.
      expect(defaultWorkspaceName('Someone')).toBe('Someone’s workspace');
    });

    it('does not give an invited collaborator a workspace of their own', async () => {
      const { workspace } = await makeTenant(db);
      const collaborator = await makeUser(db);
      await addMember(db, workspace.id, collaborator.id, 'editor');

      const current = await resolveWorkspace(db, {
        userId: collaborator.id,
        displayName: 'Collaborator',
        requested: null,
      });

      expect(current).toMatchObject({ workspaceId: workspace.id, role: 'editor' });
      expect(
        await db.select().from(workspaces).where(eq(workspaces.ownerUserId, collaborator.id)),
      ).toHaveLength(0);
    });

    it('does not re-provision someone removed from the workspace made for them', async () => {
      // Their provisioned workspace still holds the key, so a second one is refused and they have
      // nowhere to be: resolution fails closed rather than handing them ownership of anything.
      // Owners cannot be removed in iteration one; task `032` decides if that changes.
      const user = await makeUser(db);
      const first = await resolveWorkspace(db, {
        userId: user.id,
        displayName: 'Avery',
        requested: null,
      });
      await db
        .delete(workspaceMemberships)
        .where(eq(workspaceMemberships.workspaceId, first?.workspaceId ?? ''));

      expect(
        await resolveWorkspace(db, { userId: user.id, displayName: 'Avery', requested: null }),
      ).toBeNull();
      expect(
        await db.select().from(workspaces).where(eq(workspaces.ownerUserId, user.id)),
      ).toHaveLength(1);
    });

    it('writes nothing when provisioning finds someone already has a workspace', async () => {
      const { user, workspace } = await makeTenant(db);
      expect(await ensureWorkspace(db, { userId: user.id, displayName: 'x' })).toBeNull();
      expect(await eventsIn(workspace.id)).toHaveLength(0);
    });
  });

  describe('honouring the request', () => {
    async function twoWorkspaces() {
      const first = await makeTenant(db);
      const second = await makeTenant(db);
      const person = await makeUser(db);
      await addMember(db, first.workspace.id, person.id, 'viewer');
      await addMember(db, second.workspace.id, person.id, 'editor');
      return { person, first: first.workspace, second: second.workspace };
    }

    it('lands in the first workspace joined when the request names none', async () => {
      const { person, first } = await twoWorkspaces();
      const current = await resolveWorkspace(db, {
        userId: person.id,
        displayName: 'P',
        requested: null,
      });
      expect(current?.workspaceId).toBe(first.id);
    });

    it('works in the workspace the request names, when the person belongs to it', async () => {
      // "The user's only workspace" would pass every other test in this file. This is the one
      // it fails: a second membership, and a request that names it.
      const { person, second } = await twoWorkspaces();
      const current = await resolveWorkspace(db, {
        userId: person.id,
        displayName: 'P',
        requested: second.id,
      });
      expect(current).toMatchObject({ workspaceId: second.id, role: 'editor' });
    });

    it('refuses a workspace the person does not belong to, and tells its owner', async () => {
      const { person, first } = await twoWorkspaces();
      const foreign = await makeTenant(db);

      const current = await resolveWorkspace(db, {
        userId: person.id,
        displayName: 'P',
        requested: foreign.workspace.id,
      });

      // Working somewhere they belong — never in the one they asked for.
      expect(current?.workspaceId).toBe(first.id);
      const events = await eventsIn(foreign.workspace.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        action: 'access.denied',
        actorId: person.id,
        targetType: 'workspace',
        targetId: foreign.workspace.id,
        metadata: { attemptedAction: 'select_workspace' },
      });
      // And nothing about it in the workspaces they do belong to.
      expect(await eventsIn(first.id)).toHaveLength(0);
    });

    it('records a repeated refusal once per window, not once per request', async () => {
      // The preference rides on every request. Unthrottled, a stale cookie or a reload loop writes
      // without limit into somebody else's audit log.
      const { person } = await twoWorkspaces();
      const foreign = await makeTenant(db);
      const start = new Date('2026-09-22T10:00:00Z');
      const at = (offsetMs: number) => () => new Date(start.getTime() + offsetMs);
      const attempt = (offsetMs: number) =>
        resolveWorkspace(db, {
          userId: person.id,
          displayName: 'P',
          requested: foreign.workspace.id,
          now: at(offsetMs),
        });

      await Promise.all([attempt(0), attempt(1), attempt(2)]);
      await attempt(REFUSED_SELECTION_WINDOW_MS - 1);
      expect(await eventsIn(foreign.workspace.id)).toHaveLength(1);

      await attempt(REFUSED_SELECTION_WINDOW_MS + 5);
      expect(await eventsIn(foreign.workspace.id)).toHaveLength(2);
    });

    it('throttles per person, so one person’s record never hides another’s', async () => {
      const foreign = await makeTenant(db);
      const now = () => new Date('2026-09-22T10:00:00Z');
      for (const _ of [1, 2]) {
        const { person } = await twoWorkspaces();
        await resolveWorkspace(db, {
          userId: person.id,
          displayName: 'P',
          requested: foreign.workspace.id,
          now,
        });
      }
      expect(await eventsIn(foreign.workspace.id)).toHaveLength(2);
    });

    it('ignores a value that is not an id, or names no workspace, without inventing a record', async () => {
      const { person, first } = await twoWorkspaces();
      const before = await db.select().from(auditEvents);

      for (const requested of ['', 'not-a-ulid', '../../etc', testId()]) {
        const current = await resolveWorkspace(db, {
          userId: person.id,
          displayName: 'P',
          requested,
        });
        expect(current?.workspaceId).toBe(first.id);
      }

      expect(await db.select().from(auditEvents)).toHaveLength(before.length);
    });

    it('lets a switcher know before it writes a preference that would be refused', async () => {
      const { person, second } = await twoWorkspaces();
      const foreign = await makeTenant(db);
      expect(await maySelectWorkspace(db, person.id, second.id)).toBe(true);
      expect(await maySelectWorkspace(db, person.id, foreign.workspace.id)).toBe(false);
    });
  });
});
