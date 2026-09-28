import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { rosterBody } from "@features/workspaces/core/workspace-route.tsx";

/**
 * `/teams/create` — the roster with the creation modal already open.
 *
 * Creation is a modal from anywhere, not a page, but the address still has to exist: a sitemap entry, a
 * bookmark and a shared link all need somewhere to land. So this renders the index and the roster island
 * opens the modal when it sees this path. `create` is a reserved handle, so no entity can ever shadow it.
 */
export default define.page(async function CreateTeamPage(ctx) {
	ctx.state.title = "Create a team";
	return await rosterBody("team", ctx.url, readActor(ctx));
});
