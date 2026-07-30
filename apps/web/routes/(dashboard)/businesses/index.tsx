import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { rosterBody } from "@features/workspaces/core/workspace-route.tsx";

/**
 * `/businesses` — the buyer-side roster: every business the viewer owns or belongs to, plus the
 * invitations awaiting them.
 *
 * A business is a **Client with multiple members** (root CLAUDE.md §8, resolving the buyer/seller
 * ambiguity in Decision #10's wording), so its gate can never be a seller capability. Like `/teams`,
 * this is authed by the `(dashboard)` middleware and otherwise chrome + deferred RLS rather than a hard
 * server redirect, so the Dev Context Switcher can reach it as a simulated persona.
 *
 * `/businesses` (plural) is canonical; the former singular `/business` placeholder is retired.
 */
export default define.page(function BusinessesPage(ctx) {
	ctx.state.title = "Businesses";
	return rosterBody("business", ctx.url, asAuthenticatedContext(ctx.state.userContext));
});
