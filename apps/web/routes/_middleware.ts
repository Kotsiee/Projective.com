import { define } from "@web/utils/state.ts";

/**
 * Global middleware — runs for every request. Adds baseline security headers.
 *
 * This does NOT authenticate; auth is scoped to `(dashboard)/_middleware.ts`. A full Content-Security
 * -Policy (SYSTEM_ARCHITECTURE §Runtime & API Security) is layered in once asset origins are fixed.
 */
export default define.middleware(async (ctx) => {
	const res = await ctx.next();
	res.headers.set("x-frame-options", "DENY");
	res.headers.set("x-content-type-options", "nosniff");
	res.headers.set("referrer-policy", "strict-origin-when-cross-origin");
	return res;
});
