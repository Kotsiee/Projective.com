/**
 * Wallet domain types — sourced from the Zod SSOT at `@projective/types/finance`.
 *
 * App components/islands import the wallet shapes through this shim (the stable in-feature path); the fat
 * `@projective/backend` service imports the packages directly. Mirrors
 * `catalogue/types/catalogue-types.ts` / `projects/types/projects-types.ts` — nothing is redefined here.
 */
export * from "@projective/types/finance";
