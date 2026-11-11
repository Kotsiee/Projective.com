import { define } from "@web/utils/state.ts";

/**
 * `/view/[entity]/schedule` — the retired session-schedule leaf (Decision #411), permanently
 * redirected to the listing, whose Book control opens the slot picker. A `308` because the move is
 * unconditional and says nothing about who is asking.
 */
export const handler = define.handlers({
	GET(ctx) {
		const target = `${ctx.url.pathname.replace(/\/schedule\/?$/, "")}${ctx.url.search}`;
		return new Response(null, { status: 308, headers: { location: target } });
	},
});
