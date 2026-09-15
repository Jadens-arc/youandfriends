# 124 — Deployment path and runbook verification

**Phase:** Quality, release, closeout · **Iteration:** one

## Objective

Verify the complete deployment path end to end — Vercel, Neon, Clerk, R2, Liveblocks, Trigger.dev — and confirm every runbook in `docs/OPERATIONS.md` actually works.

## User value

A deployment that can be performed confidently by following written steps, and runbooks that have been executed rather than merely written.

## Scope

- End-to-end deployment following `docs/OPERATIONS.md` §1 exactly, correcting the document where reality differs.
- Environment variable configuration verified across Vercel, Trigger.dev, and local development.
- Migration application against the production database following the documented procedure.
- Smoke checklist (`docs/OPERATIONS.md` §7) executed against the deployed instance.
- Verification of each runbook: stuck uploads, stuck jobs, orphan reconciliation, key rotation.
- A restore drill against a Neon branch — because an untested backup is a hypothesis.
- `README.md` setup instructions verified from a clean clone.

## Non-scope

- Production monitoring dashboards.
- Custom domain and DNS configuration for `youandfriends.org` — a user action requiring credentials.
- Multi-environment promotion workflows.

## Dependencies

`123`, `122`

## Files expected to change

```
docs/OPERATIONS.md
README.md
.env.example
vercel.json
```

## Implementation notes

- Follow the written steps literally, including the parts that seem obvious. Every place reality differs from the document is a place the next person would get stuck.
- The restore drill is the highest-value item here. `docs/OPERATIONS.md` §6 says an untested backup is a hypothesis — this task is where it stops being one.
- Verify that `apps/jobs` has its own environment configuration. It is the deployment most easily forgotten (`docs/OPERATIONS.md` §8) because nothing user-visible breaks until the next upload.
- Run each runbook against a real (non-production or carefully chosen) situation. A runbook that has never been executed is a draft.
- Custom domain setup needs the user's DNS access — document the steps and stop there rather than guessing.

## Security/privacy considerations

Deployment involves real credentials. None are committed; all are configured in provider dashboards. This task verifies the least-privilege posture of each credential and confirms key rotation (`docs/OPERATIONS.md` §8) works before it is needed in an emergency.

## Acceptance criteria

- [ ] Deployment succeeds following the documented steps, with the document corrected where it was wrong.
- [ ] Environment variables are verified across Vercel, Trigger.dev, and local development.
- [ ] Migrations apply following the documented procedure.
- [ ] The smoke checklist passes against the deployed instance.
- [ ] Each runbook is executed and confirmed working.
- [ ] A restore drill succeeds against a Neon branch.
- [ ] `README.md` setup works from a clean clone.
- [ ] Key rotation is verified before it is needed.

## Tests and validation commands

```bash
pnpm release-check
# Deploy following docs/OPERATIONS.md §1, then run the §7 smoke checklist
```

## Manual QA

1. Deploy following only the written steps; note every gap and fix the document.
2. Execute each runbook and confirm it works as written.
3. Perform a restore drill and confirm the data returns.

## Rollback/compatibility

Documentation and configuration. Reverting loses verified procedures. A deployed instance is not affected by reverting this task.

## Status

`pending`

## Commit

_(not yet)_
