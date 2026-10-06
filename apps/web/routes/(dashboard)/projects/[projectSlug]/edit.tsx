import { define } from "@web/utils/state.ts";
import { projectDetailsHref } from "@features/projects/core/project-access.ts";

/**
 * `/projects/[slug]/edit` — retired, and kept as a permanent redirect rather than deleted.
 *
 * The editor used to be a separate page beside a read-only Preview, then the owner's half of the
 * engagement's root. Since Decision #144 it lives at `/projects/[slug]/details`, the configuration's
 * own address, and the root is the engagement's Overview. "Edit" meant the editor, so it lands on the
 * editor — not on the Overview it would reach if it still pointed at the root.
 *
 * `308` rather than `303`: the move is permanent, unconditional and method-preserving, so a bookmark,
 * a link in an old notification and anything that had this URL stored all land on the surface that
 * replaced it instead of a 404. The file stays for exactly that reason — deleting the route would
 * make every one of those a dead end.
 */
export const handler = define.handlers({
	GET(ctx) {
		return new Response(null, {
			status: 308,
			headers: { location: projectDetailsHref(ctx.params.projectSlug) },
		});
	},
});
