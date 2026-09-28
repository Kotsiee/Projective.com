import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { rosterBody } from "@features/workspaces/core/workspace-route.tsx";

/**
 * `/businesses` — the buyer-side roster: every business the viewer owns or belongs to, plus the
 * invitations awaiting them. Read live, as the signed-in viewer.
 *
 * A business is a **Client with multiple members**, so its gate can never be a seller capability;
 * membership is decided by the database. `/businesses` (plural) is canonical.
 */
export default define.page(async function BusinessesPage(ctx) {
	ctx.state.title = "Businesses";
	return await rosterBody("business", ctx.url, readActor(ctx));
});
