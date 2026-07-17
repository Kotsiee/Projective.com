/**
 * @projective/types/auth — the Zod SSOT for cross-boundary auth/session shapes.
 *
 * Currently the User Context Hydration model: the chrome-only description of who a request is acting
 * as, resolved server-side from the session JWT and shipped into SSR. Import via the sub-path
 * (`@projective/types/auth`) or the barrel.
 */
export * from "./user-context.ts";
