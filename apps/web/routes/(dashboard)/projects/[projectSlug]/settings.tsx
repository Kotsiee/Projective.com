import { define } from "@web/utils/state.ts";
import { projectDetailsHref } from "@features/projects/core/project-access.ts";

/**
 * `/projects/[slug]/settings` — an alias, permanently redirected to `/projects/[slug]/details`
 * (Decision #144).
 *
 * "Settings" is the word people guess for an engagement's configuration, and without this static
 * route the segment fell through to `[channelId]` and rendered an EMPTY ROOM with a working composer —
 * an address that offered to post into a conversation that did not exist. A `308` because the alias
 * is unconditional: it says nothing about who is asking, so it is safe to cache, and the method is
 * preserved. Whether the viewer may see the configuration is `/details`'s question.
 */
export const handler = define.handlers({
	GET(ctx) {
		return new Response(null, {
			status: 308,
			headers: { location: projectDetailsHref(ctx.params.projectSlug) },
		});
	},
});
