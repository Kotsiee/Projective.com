import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { rosterBody } from "@features/workspaces/core/workspace-route.tsx";

/**
 * `/teams` — the seller-side roster: every team the viewer owns or belongs to, plus the invitations
 * awaiting them.
 *
 * Thin controller. Authed by the `(dashboard)` middleware; seller-ness is chrome + deferred RLS, NOT a
 * hard server redirect — the client-side Dev Context Switcher must be able to reach this surface as a
 * simulated persona, and the server never sees that seam (consistent with every sibling route).
 *
 * The lane, header band and footer band are resolved separately by the shell's slot resolvers, so this
 * route owns only the body.
 */
export default define.page(function TeamsPage(ctx) {
	ctx.state.title = "Teams";
	return rosterBody("team", ctx.url, asAuthenticatedContext(ctx.state.userContext));
});
