import { define } from "@web/utils/state.ts";

/**
 * `/[handle]/view/[item]/schedule` — the retired profile-namespace session-schedule leaf (Decision
 * #411), permanently redirected to the listing in the same namespace.
 */
export const handler = define.handlers({
	GET(ctx) {
		const target = `${ctx.url.pathname.replace(/\/schedule\/?$/, "")}${ctx.url.search}`;
		return new Response(null, { status: 308, headers: { location: target } });
	},
});
