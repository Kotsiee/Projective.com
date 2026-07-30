import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { rosterBody } from "@features/workspaces/core/workspace-route.tsx";

/**
 * `/businesses/create` — the roster with the creation modal already open. See the team twin: creation is
 * a modal from anywhere, but the address still has to resolve for a bookmark or a shared link.
 */
export default define.page(function CreateBusinessPage(ctx) {
	ctx.state.title = "Create a business";
	return rosterBody("business", ctx.url, asAuthenticatedContext(ctx.state.userContext));
});
