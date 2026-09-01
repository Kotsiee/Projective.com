import { define } from "@web/utils/state.ts";

/**
 * `/projects/[projectId]/edit` — retired, and kept as a permanent redirect rather than deleted.
 *
 * The editor used to be a separate page beside a read-only Preview. It is now the Details half of
 * `/projects/[projectId]` itself, so the engagement has ONE working address and the owner is never
 * looking at a stale copy of a form that lives somewhere else.
 *
 * `308` rather than `303`: the move is permanent and the method must be preserved, so a bookmark, a
 * link in an old notification and anything that had this URL stored all land on the surface that
 * replaced it instead of a 404. The file stays for exactly that reason — deleting the route would
 * make every one of those a dead end.
 */
export const handler = define.handlers({
	GET(ctx) {
		return new Response(null, {
			status: 308,
			headers: { location: `/projects/${ctx.params.projectId}` },
		});
	},
});
