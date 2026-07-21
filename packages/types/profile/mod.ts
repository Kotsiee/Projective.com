/**
 * @projective/types/profile — the Zod SSOT barrel for the public profile domain (`/[handle]`).
 *
 * The header + overview projection ({@link ProfileView}) and the entity-driven tab system
 * ({@link ProfileTab} · {@link ProfileTabPayload}). Item grids reuse `@projective/types/explore`, so a
 * profile tab renders through the same cards as `/explore` (a read projection, not a parallel corpus).
 */
export * from "./profile.ts";
export * from "./tabs.ts";
export * from "./reserved.ts";
