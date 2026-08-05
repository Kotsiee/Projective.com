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
 *
 * **Two of the three are floors; one is a default.** This middleware runs OUTSIDE every route, so its
 * post-processing is the last thing to touch the response — a `set` here silently overwrites whatever
 * a route decided. `x-frame-options` and `x-content-type-options` are non-negotiable and are set
 * unconditionally. `referrer-policy` is not: a route whose URL *is* a secret must be able to harden it
 * to `no-referrer` (the public `/share/[slug]` capability URL does exactly that), and an unconditional
 * `set` would quietly undo it while the route's own code still read as though it had worked. So the
 * platform value is applied only when the response has not already answered for itself — a floor a
 * route may raise, never one it can lower, since nothing removes the header.
 */
export default define.middleware(async (ctx) => {
	ctx.state.isAuthenticated = hasSessionCookie(ctx.req);
	ctx.state.userContext = resolveRequestContext(ctx.req);
	const res = await ctx.next();
	res.headers.set("x-frame-options", "DENY");
	res.headers.set("x-content-type-options", "nosniff");
	if (!res.headers.has("referrer-policy")) {
		res.headers.set("referrer-policy", "strict-origin-when-cross-origin");
	}
	return res;
});
