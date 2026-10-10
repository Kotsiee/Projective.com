import { define } from "@web/utils/state.ts";
import { ensureSession } from "@web/utils/session.ts";
import { resolveTokenContext } from "@web/utils/user-context.ts";

/**
 * Standalone-group middleware — pages rendered with no shell (the file inspector). Renews an expired
 * session in place, like `[handle]/_middleware.ts`, so a returning owner is still recognised; never
 * redirects, because a guest may open a public file or a share link here.
 */
export default define.middleware(async (ctx) => {
	const session = await ensureSession(ctx.req);
	if (session.authenticated && session.accessToken) {
		ctx.state.accessToken = session.accessToken;
		if (session.refreshed) {
			ctx.state.isAuthenticated = true;
			ctx.state.userContext = resolveTokenContext(session.accessToken);
		}
	}

	const res = await ctx.next();
	for (const cookie of session.setCookies) res.headers.append("set-cookie", cookie);
	for (const cookie of session.clearCookies) res.headers.append("set-cookie", cookie);
	return res;
});
