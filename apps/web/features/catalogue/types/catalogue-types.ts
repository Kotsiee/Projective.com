/**
 * Catalogue domain types — sourced from the Zod SSOT at `@projective/types/catalogue`.
 *
 * App components/islands import shapes through this shim (the stable in-feature path); the fat
 * `@projective/backend` service imports the packages directly. `ServiceType` is re-exported from the
 * explore domain because the catalogue reuses it verbatim for the service delivery model (no fork).
 * Mirrors `projects/types/projects-types.ts` / `messaging/types/messaging-types.ts`.
 */
export * from "@projective/types/catalogue";
export type { EntityPricing, ExploreOwner, ServiceType, SkillRef } from "@projective/types/explore";
