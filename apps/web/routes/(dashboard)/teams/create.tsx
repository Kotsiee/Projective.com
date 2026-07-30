import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { rosterBody } from "@features/workspaces/core/workspace-route.tsx";

/**
 * `/teams/create` — the roster with the creation modal already open.
 *
 * Creation is a modal from anywhere, not a page (brief §5), but the address still has to exist: a
 * sitemap entry, a bookmark and a shared link all need somewhere to land. So this renders the index and
 * the roster island opens the modal when it sees this path — one surface, two ways in, and no separate
 * page to keep in step with the modal.
 */
export default define.page(function CreateTeamPage(ctx) {
	ctx.state.title = "Create a team";
	return rosterBody("team", ctx.url, asAuthenticatedContext(ctx.state.userContext));
});
