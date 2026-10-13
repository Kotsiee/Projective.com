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
 * the OAuth-signup exemption); this is only the HTTP plumbing around it. It reads only the VERIFIED
 * session the global middleware already resolved, so it bounces a valid token alone: a tampered,
 * expired or foreign cookie reaches the sign-in screen it needs instead of being sent to `/home`.
 * Never a loop — the dashboard guard admits exactly the tokens this bounces, and `safeRedirect`
 * refuses auth paths as a `redirectTo`.
 */
export default define.middleware((ctx) => {
	const bounce = resolveAuthScreenBounce(ctx.url, !!ctx.state.isAuthenticated);
	if (!bounce) return ctx.next();

	const dest = new URL(bounce, ctx.url);
	return new Response(null, { status: 302, headers: { location: dest.href } });
});
