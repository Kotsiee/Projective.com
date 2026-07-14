/**
 * @projective/types — the Zod single source of truth for shapes shared across the workspace.
 *
 * Every table's row/insert schema and every cross-boundary payload shape is defined here exactly
 * once, so the database migration, the `@projective/backend` services, the API routes, and the
 * `documentation/database/*` docs can never drift (root CLAUDE.md §1, database/CLAUDE.md Zod SSOT
 * Rule). Import domains by sub-path (`@projective/types/org`) or everything from the barrel.
 */
export * from "./org/mod.ts";
export * from "./explore/mod.ts";
export * from "./newsletter/mod.ts";
