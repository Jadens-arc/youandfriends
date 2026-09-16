/**
 * Forbid reaching the database from a request-handling file without going through `authz`.
 *
 * ADR 0006 puts every authorization decision in `@youandfriends/authz`. This rule is what
 * makes that survive contributors who have not read the ADR: a handler that imports
 * `@youandfriends/db` and queries by id, with no tenant filter and no permission check, is a
 * cross-tenant data leak, and it looks exactly like correct code.
 *
 * The rule is deliberately crude. It does not try to prove a query is scoped — it requires
 * the two imports to appear together and leaves the rest to review. Crude and mechanical
 * beats clever and bypassable: the failure it prevents is someone forgetting entirely.
 */

const DB_PACKAGE = '@youandfriends/db';
const AUTHZ_PACKAGE = '@youandfriends/authz';

/** @type {import('eslint').Rule.RuleModule} */
export const noUnscopedDb = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require @youandfriends/authz alongside @youandfriends/db in request-handling code',
    },
    schema: [
      {
        type: 'object',
        properties: {
          /** Extra specifiers treated as reaching the database directly. */
          databaseModules: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      unscoped:
        'This file imports {{ database }} without {{ authz }}. Tenant-scoped reads go through ' +
        'the authorizer — see ADR 0006. If this file genuinely needs neither a permission ' +
        'check nor a tenant filter, it does not belong in a route.',
    },
  },

  create(context) {
    const extra = context.options[0]?.databaseModules ?? [];
    const databaseModules = new Set([DB_PACKAGE, ...extra]);

    /** @type {import('estree').ImportDeclaration[]} */
    const databaseImports = [];
    let importsAuthz = false;

    /** True for the package itself and for any subpath of it. */
    const isDatabaseModule = (source) =>
      [...databaseModules].some((name) => source === name || source.startsWith(`${name}/`));

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source !== 'string') return;

        if (source === AUTHZ_PACKAGE || source.startsWith(`${AUTHZ_PACKAGE}/`)) {
          importsAuthz = true;
          return;
        }

        if (isDatabaseModule(source)) databaseImports.push(node);
      },

      'Program:exit'() {
        if (importsAuthz) return;

        for (const node of databaseImports) {
          context.report({
            node,
            messageId: 'unscoped',
            data: { database: DB_PACKAGE, authz: AUTHZ_PACKAGE },
          });
        }
      },
    };
  },
};

export const rules = { 'no-unscoped-db': noUnscopedDb };
