import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';

import { noUnscopedDb } from './no-unscoped-db.mjs';

/**
 * A lint rule that never fires is worse than no lint rule: it reads as a control and enforces
 * nothing. The boundary rule in task `010` shipped inert for exactly that reason, so this one
 * is tested against the code it is meant to reject.
 *
 * `apps/web` also carries an end-to-end check — a deliberate violation was linted during task
 * `022` and the rule rejected it — because a rule that passes `RuleTester` can still be wired
 * into a config that never matches a file.
 */
const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
});

// RuleTester drives the test framework's own `describe`/`it` when they are global, so each
// case below reports as its own test rather than collapsing into one.
RuleTester.describe = describe;
RuleTester.it = it;

tester.run('no-unscoped-db', noUnscopedDb, {
  valid: [
    {
      name: 'both imports together',
      code: `
        import { createAuthorizer } from '@youandfriends/authz';
        import { songs } from '@youandfriends/db';
      `,
    },
    {
      name: 'authorizer alone',
      code: `import { assertCan } from '@youandfriends/authz';`,
    },
    {
      name: 'neither',
      code: `import { Button } from '@youandfriends/ui';`,
    },
    {
      name: 'a subpath of authz still counts as importing it',
      code: `
        import { scopedQuery } from '@youandfriends/authz/scoped';
        import { songs } from '@youandfriends/db';
      `,
    },
    {
      name: 'the testing subpath, alongside the authorizer',
      code: `
        import { createAuthorizer } from '@youandfriends/authz';
        import { createTestDatabase } from '@youandfriends/db/testing';
      `,
    },
  ],

  invalid: [
    {
      name: 'the database alone',
      code: `import { songs } from '@youandfriends/db';`,
      errors: [{ messageId: 'unscoped' }],
    },
    {
      name: 'a subpath of the database is still the database',
      code: `import { songs } from '@youandfriends/db/schema';`,
      errors: [{ messageId: 'unscoped' }],
    },
    {
      name: 'every offending import is reported, not just the first',
      code: `
        import { songs } from '@youandfriends/db';
        import { projects } from '@youandfriends/db/schema';
      `,
      errors: [{ messageId: 'unscoped' }, { messageId: 'unscoped' }],
    },
    {
      name: 'a similarly-named package does not satisfy the requirement',
      code: `
        import { thing } from '@youandfriends/authz-helpers';
        import { songs } from '@youandfriends/db';
      `,
      errors: [{ messageId: 'unscoped' }],
    },
    {
      name: 'an additional database module named in options',
      code: `import { pool } from '@youandfriends/legacy-db';`,
      options: [{ databaseModules: ['@youandfriends/legacy-db'] }],
      errors: [{ messageId: 'unscoped' }],
    },
  ],
});
