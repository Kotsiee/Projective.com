import { define } from "@web/utils/state.ts";

/**
 * `/projects/create` — retired. The standalone create *page* was replaced by the in-lane Project
 * Creation Modal (launched from the lane's `proj-lane__create` menu). This thin redirect is kept only
 * as a deprecation shim: it 307s any stale link back to `/projects` (where the modal lives) and, being
 * a static route, also prevents `create` from being captured by the dynamic `[projectId]` route as a
 * bogus project slug. No UI is rendered here.
 */
export const handler = define.handlers({
	GET() {
		return new Response(null, { status: 307, headers: { Location: "/projects" } });
	},
});
