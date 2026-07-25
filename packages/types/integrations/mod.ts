/**
 * `@projective/types/integrations` — the connector + plugin substrate barrel.
 *
 * Backs the `integrations` schema, the platform's integration & plugin platform. Two subsystems:
 *
 *   * **Connectors** — the provider catalogue ({@link ./providers.ts}) and a user's stored
 *     authorization to act at one ({@link ./connections.ts}). Platform AUTH (SSO login) and INFRA
 *     (Stripe, Maps) are deliberately NOT modelled here — authentication ≠ authorization.
 *   * **Plugins** — the developer registry, versions, extension-point + scope catalogues and
 *     installations ({@link ./plugins.ts}).
 *
 * ⚠️ No token/secret shape exists anywhere in this package — the vault and operational tables are
 * service-role only. Clients read `integrations.v_my_connections` ({@link UserConnectionSchema}).
 *
 * The migration, these schemas, and `documentation/database/integrations/*` land together
 * (root CLAUDE.md §1).
 *
 * @module
 */
export * from "./common.ts";
export * from "./providers.ts";
export * from "./connections.ts";
export * from "./plugins.ts";
