# 208 — Billing and subscription management

**Phase:** Administration · **Iteration:** **deferred** (post-iteration-one)

## Objective

Add billing for workspaces beyond the personal prototype: plans, quotas, payment, and invoicing.

## User value

Sustaining the product beyond a single private workspace.

## Scope

- Plan definitions with storage and member quotas.
- Payment provider integration.
- Quota enforcement tied to plan.
- Invoicing and payment history.
- Upgrade, downgrade, and cancellation with a documented data-retention policy on cancellation.

## Non-scope

- Multi-tenant commercial operation at scale — a stated iteration-one non-goal.
- Usage-based metering beyond storage.
- Reseller or team billing hierarchies.

## Dependencies

`207`, `031`

## Files expected to change

```
packages/db/src/schema/billing.ts
apps/web/app/(workspace)/settings/billing/**
apps/jobs/src/billing.ts
```

## Implementation notes

- This requires product and legal decisions that are not engineering's to make alone: pricing, refund policy, and what happens to a user's music when they stop paying. **Ask before building.**
- The data-retention-on-cancellation policy is the most consequential decision here. Deleting someone's masters because a card expired would be indefensible; a documented grace period is essential.
- Quota enforcement already has a seam (`YOUANDFRIENDS_WORKSPACE_QUOTA_BYTES`, task `031`) — wire plans to it rather than adding a second mechanism.
- Payment provider credentials are high-value secrets with the same handling as every other credential.

## Security/privacy considerations

Payment data must never touch our database — use the provider's hosted flows and store only references. Billing routes are owner-only and audited. Cancellation must not trigger immediate deletion of user music.

## Acceptance criteria

- [ ] Plans define storage and member quotas.
- [ ] Payment integrates through hosted provider flows; no card data is stored.
- [ ] Quotas are enforced via the existing configuration seam.
- [ ] Invoicing and payment history are available.
- [ ] Upgrade, downgrade, and cancellation work.
- [ ] The data-retention policy on cancellation is documented and approved by the user before implementation.
- [ ] Billing routes are owner-only and audited.

## Tests and validation commands

```bash
pnpm --filter web test
pnpm --filter @youandfriends/authz test
```

## Manual QA

1. Complete a plan change end to end in provider test mode.
2. Exceed a quota and confirm enforcement.
3. Cancel and confirm the retention policy is honored.

## Rollback/compatibility

**Blocked pending product and legal decisions.** Do not begin without explicit user direction on pricing and cancellation data policy.

## Status

`pending`

## Commit

_(not yet)_
