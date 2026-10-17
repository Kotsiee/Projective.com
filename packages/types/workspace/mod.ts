/**
 * `workspace` shapes — the multi-member entity console (`/teams`, `/businesses`).
 *
 * **A Team is a Freelancer with multiple members; a Business is a Client with multiple members.** One
 * architecture serves both, parameterised by {@link WorkspaceKind}; everything that differs is a
 * capability table (`common.ts`), never a forked schema.
 *
 * These are read+write **projections** over the existing `org.teams` / `org.business_profiles` /
 * `org.*_members` / `org.*_roles` tables — no migration accompanies them, which is why they live here
 * rather than in the DB-row-mirroring `org` sub-path.
 *
 *   - `common`  — kinds, statuses, roles, the capability vocabulary, per-kind copy.
 *   - `access`  — which money and admin screens a viewer may open (one predicate per module).
 *   - `authority` — the business-project refusals (`hire`, `purchase`, `manage_projects`, funders).
 *   - `members` — membership, invitations, and the three-layer permission engine.
 *   - `policy`  — team payout splits · business pooled-wallet spend governance.
 *   - `workspace` — the roster + console read projections and every mutation payload.
 */
export * from "./access.ts";
export * from "./authority.ts";
export * from "./common.ts";
export * from "./members.ts";
export * from "./policy.ts";
export * from "./workspace.ts";
