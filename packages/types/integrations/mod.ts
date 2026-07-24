/**
 * `@projective/types/integrations` — the third-party OAuth connection domain barrel.
 *
 * Backs the `integrations` schema (migration `20260724101000_integrations_connections.sql`): the
 * provider catalogue plus a user's stored authorization to act on their behalf at a calendar or
 * conferencing provider. The migration, these schemas, and
 * `documentation/database/integrations/*` land together (root CLAUDE.md §1).
 *
 * See {@link ./connections.ts}.
 */
export * from "./connections.ts";
