import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { NON_TENANT_TABLES, schema } from './index';

/**
 * The schema as declared, checked without a database.
 *
 * `schema.test.ts` checks the same invariants against a live migrated database, which is the
 * stronger assertion — it sees what Postgres actually did. This one fails earlier and in a
 * more useful place: a bad index definition here is caught before a migration is generated
 * from it, rather than after one has been applied somewhere.
 */

const tables = Object.entries(schema) as [string, PgTable][];

describe('table declarations', () => {
  it.each(tables)('%s declares a name and a primary key', (_, table) => {
    const config = getTableConfig(table);
    expect(config.name).toMatch(/^[a-z_]+$/);
    expect(config.columns.some((column) => column.primary)).toBe(true);
  });

  it.each(tables)('%s names its columns in snake_case', (_, table) => {
    // Drizzle maps property names to column names, and a camelCase column would work fine
    // in TypeScript while reading badly in every hand-written query and every migration.
    for (const column of getTableConfig(table).columns) {
      expect(column.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  const tenantOwned = tables.filter(
    ([, table]) => !(getTableConfig(table).name in NON_TENANT_TABLES),
  );

  it('finds tenant-owned tables to check', () => {
    expect(tenantOwned.length).toBeGreaterThan(0);
  });

  it.each(tenantOwned)('%s carries a not-null workspace_id', (_, table) => {
    const column = getTableConfig(table).columns.find((c) => c.name === 'workspace_id');
    expect(column).toBeDefined();
    expect(column?.notNull).toBe(true);
  });

  it.each(tenantOwned)('%s leads an index with workspace_id', (_, table) => {
    const config = getTableConfig(table);
    const leading = [...config.indexes, ...config.uniqueConstraints].map((index) => {
      const columns = 'config' in index ? index.config.columns : [];
      const first = columns[0];
      return first && 'name' in first ? first.name : undefined;
    });

    // Second place in a composite index is not a tenant column; it is a column the planner
    // ignores. Every query in the product is workspace-scoped.
    expect(leading).toContain('workspace_id');
  });

  it.each(tenantOwned)('%s has a foreign key from workspace_id to workspaces', (_, table) => {
    const hasWorkspaceForeignKey = getTableConfig(table)
      .foreignKeys.map((key) => key.reference())
      .some(
        ({ columns, foreignTable }) =>
          columns.some((column) => column.name === 'workspace_id') &&
          getTableConfig(foreignTable).name === 'workspaces',
      );

    // Without it, a row can name a workspace that does not exist — which is not a leak, but
    // it is a row nobody can reach and nobody can clean up.
    expect(hasWorkspaceForeignKey).toBe(true);
  });
});
