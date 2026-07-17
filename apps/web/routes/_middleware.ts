import { define } from "@web/utils/state.ts";
import { hasSessionCookie } from "@web/utils/auth-cookies.ts";
import { resolveRequestContext } from "@web/utils/user-context.ts";

/**
 * Global middleware — runs for every request. Resolves auth **site-wide** (chrome only) and adds
 * baseline security headers.
 *
 * `isAuthenticated` is set from a skeleton session-cookie presence check, and `userContext` from an
 * unverified decode of the session JWT's claims (User Context Hydration), so EVERY route — including
 * the public Home/Explore surfaces — can render the correct navigation shell and skeletons in SSR
 * (guest vs unified user L-shell, and which structural context to frame). Both are presence/skeleton
 * signals: they do NOT verify the JWT and grant no access; the `(dashboard)/_middleware.ts` guard +
 * RLS remain the real gates. A full Content-Security-Policy (SYSTEM_ARCHITECTURE §Runtime & API
 * Security) is layered in once asset origins are fixed.
 */
export default define.middleware(async (ctx) => {
	ctx.state.isAuthenticated = hasSessionCookie(ctx.req);
	ctx.state.userContext = resolveRequestContext(ctx.req);
	const res = await ctx.next();
	res.headers.set("x-frame-options", "DENY");
	res.headers.set("x-content-type-options", "nosniff");
	res.headers.set("referrer-policy", "strict-origin-when-cross-origin");
	return res;
});
