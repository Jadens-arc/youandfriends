/**
 * `@youandfriends/contracts`
 *
 * Every shape that crosses a trust boundary: Zod schemas, roles and capabilities, the error
 * taxonomy, and pagination. Imported by `authz`, the API, and the UI so the three cannot
 * drift from each other.
 *
 * This package deliberately depends on nothing in the repository except `config`. A lint
 * boundary rule enforces that it never imports `db`, `storage`, or React
 * (docs/ARCHITECTURE.md §3).
 */

export const PACKAGE_NAME = '@youandfriends/contracts' as const;

export * from './actions';
export * from './assets';
export * from './audit';
export * from './errors';
export * from './ids';
export * from './uploads';
export * from './versions';
export * from './snapshots';
export * from './library';
export * from './lyrics';
export * from './notifications';
export * from './waveform';
export * from './pagination';
export * from './queue';
export * from './result';
export * from './serving';
export * from './roles';
export * from './work-status';
