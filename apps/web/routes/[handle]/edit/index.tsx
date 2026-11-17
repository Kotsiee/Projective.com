import { define } from "@web/utils/state.ts";

/**
 * `/[handle]/edit` — retired (Decision #439), kept as a permanent redirect rather than deleted.
 *
 * The owner's Edit profile & settings page is gone: the profile is edited in place on `/[handle]`
 * itself, and the account-level settings it carried (visibility, the display switches) live in
 * Settings → Profile. The browser carries a fragment across the redirect, so an old deep link such as
 * `/[handle]/edit#skills` lands on `/[handle]#skills` and opens that block's editor for its owner.
 *
 * `308`: the move is permanent and method-preserving, so a bookmark or a link in an old notification
 * lands on the surface that replaced it instead of a 404.
 */
export const handler = define.handlers({
	GET(ctx) {
		const handle = ctx.state.profile?.handle ?? ctx.params.handle;
		return new Response(null, {
			status: 308,
			headers: { location: `/${handle}${ctx.url.search}` },
		});
	},
});
