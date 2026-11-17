import { define } from "@web/utils/state.ts";
import { ownerBlockHref } from "@features/profile/core/owner-edit.ts";

/**
 * `/[handle]/edit/availability` — retired (Decision #439), kept as a permanent redirect.
 *
 * Whether the hours show and the time zone they are kept in are edited in place on the profile's
 * Availability block, which `/[handle]#availability` opens for its owner; the call terms are
 * Settings → Scheduling's, and the weekly hours stay on `/calendar?view=availability`.
 */
export const handler = define.handlers({
	GET(ctx) {
		const handle = ctx.state.profile?.handle ?? ctx.params.handle;
		return new Response(null, {
			status: 308,
			headers: { location: ownerBlockHref(handle, "availability") },
		});
	},
});
