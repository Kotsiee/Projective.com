/**
 * Explore domain types — sourced from the Zod SSOT at `@projective/types/explore`.
 *
 * This module stays as the feature's stable import path (`../types/explore-types.ts`); it simply
 * re-exports the SSOT so the discovery entities, query params, and result groups are defined exactly
 * once (root CLAUDE.md §1, the Zod SSOT rule). Components import types from here; the backend service
 * imports the `@projective/types/explore` package directly (it cannot import app code).
 */
export * from "@projective/types/explore";
