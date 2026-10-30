/**
 * @projective/types/auth — the Zod SSOT for cross-boundary auth/session shapes.
 *
 * The User Context Hydration model (the chrome-only description of who a request is acting as,
 * resolved server-side from the session JWT), the age guardrails and the `/join` request schema.
 * Import via the sub-path (`@projective/types/auth`) or the barrel.
 */
export * from "./user-context.ts";
export * from "./session-context.ts";
export * from "./identities.ts";
export * from "./age.ts";
export * from "./join.ts";
