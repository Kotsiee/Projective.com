import { define } from "@web/utils/state.ts";
import { ensureSession } from "@web/utils/session.ts";
import { resolveTokenContext } from "@web/utils/user-context.ts";

/**
 * Dashboard auth guard — scoped to the authenticated app (route group `(dashboard)`).
 *
 * SKELETON: gates on the presence of a Supabase session, but — crucially — **attempts a silent token
 * refresh before redirecting out**. When the short-lived access cookie has expired yet a valid refresh
 * cookie remains, {@link ensureSession} renews the session (fat {@link AuthBackendService}) and we
 * re-mint the `sb-*` cookies on the way out instead of bouncing the user to `/login` — this is what
 * keeps an active session (notably a Google-OAuth one, whose access token is ~1h) alive across
 * long-lived navigation like `/projects/…`. Only a genuinely dead session (no cookies, or a
 * spent/invalid refresh token) is redirected, capturing the **full** target path (pathname + query)
 * as `redirectTo` so the user returns exactly where they were after signing back in.
 *
 * Still skeleton-grade: real JWT signature verification via `@server/services` is the remaining TODO
 * (SYSTEM_ARCHITECTURE §Security); RLS is the backstop. Islands never run this — it is server-side,
 * pre-handler.
 */
export default define.middleware(async (ctx) => {
	const session = await ensureSession(ctx.req);

	if (!session.authenticated) {
		const dest = new URL("/login", ctx.url);
		// Preserve the exact target (including any query string) so the return trip is loss-free.
		dest.searchParams.set("redirectTo", ctx.url.pathname + ctx.url.search);
		const res = new Response(null, { status: 302, headers: { location: dest.href } });
		for (const cookie of session.clearCookies) res.headers.append("set-cookie", cookie);
		return res;
	}

	ctx.state.isAuthenticated = true;
	ctx.state.accessToken = session.accessToken;
	// A just-renewed session's cookie is still stale on the request, so re-derive the chrome context
	// from the fresh token — otherwise the global middleware's guest read (from the dropped cookie)
	// would paint guest chrome for this one render.
	if (session.refreshed && session.accessToken) {
		ctx.state.userContext = resolveTokenContext(session.accessToken);
	}

	const res = await ctx.next();
	// Mint the renewed session cookies onto the proceeding response (empty on the fast path).
	for (const cookie of session.setCookies) res.headers.append("set-cookie", cookie);
	return res;
});
