import { define } from "@web/utils/state.ts";
import { resolveAuthScreenBounce } from "@features/auth/core/auth-routing.ts";

/**
 * Auth-screen guard — the mirror image of the `(dashboard)` guard.
 *
 * `(dashboard)` bounces a signed-OUT visitor to `/login` carrying their target as `redirectTo`; this
 * bounces a signed-IN visitor OFF the sign-in / sign-up screens to that same captured target (or the
 * default landing page). Without it an authenticated user who lands on `/login` or `/join` — from a
 * bookmark, a public-header link, or a back-navigation after signing in — is asked to authenticate
 * again and, on `/join`, is walked back through onboarding they have already completed.
 *
 * The decision itself lives in {@link resolveAuthScreenBounce} (pure, unit-tested, and the owner of
 * the OAuth-signup exemption); this is only the HTTP plumbing around it. It reads nothing but the
 * session-cookie presence the global middleware already resolved, so it stays network-free: this is
 * chrome-level routing, not an access decision — RLS and the dashboard guard remain the real gates.
 */
export default define.middleware((ctx) => {
	const bounce = resolveAuthScreenBounce(ctx.url, !!ctx.state.isAuthenticated);
	if (!bounce) return ctx.next();

	const dest = new URL(bounce, ctx.url);
	return new Response(null, { status: 302, headers: { location: dest.href } });
});
