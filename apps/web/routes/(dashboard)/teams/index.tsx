import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { rosterBody } from "@features/workspaces/core/workspace-route.tsx";

/**
 * `/teams` — the seller-side roster: every team the viewer owns or belongs to, plus the invitations
 * awaiting them. Read live, as the signed-in viewer.
 *
 * Thin controller. Authed by the `(dashboard)` middleware; membership is decided by the database, never
 * by a chrome flag. The lane, header band and footer band are resolved separately by the shell's slot
 * resolvers — they share this page's roster read through the request memo in `workspace-ssr`.
 */
export default define.page(async function TeamsPage(ctx) {
	ctx.state.title = "Teams";
	return await rosterBody("team", ctx.url, readActor(ctx));
});
