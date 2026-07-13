import { define } from "@web/utils/state.ts";

/**
 * Dashboard auth guard — scoped to the authenticated app (route group `(dashboard)`).
 *
 * SKELETON: checks for a Supabase session cookie and bounces to /login if absent. Replace the
 * presence check with real JWT verification via `@server/services` (SYSTEM_ARCHITECTURE §Security);
 * RLS is still the backstop. Islands never run this — it is server-side, pre-handler.
 */
export default define.middleware((ctx) => {
	const hasSession = ctx.req.headers.get("cookie")?.includes("sb-access-token");
	if (!hasSession) {
		const dest = new URL("/login", ctx.url);
		dest.searchParams.set("redirectTo", ctx.url.pathname);
		return new Response(null, { status: 302, headers: { location: dest.href } });
	}
	ctx.state.isAuthenticated = true;
	return ctx.next();
});
