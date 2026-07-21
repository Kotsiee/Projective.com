import { define } from "@web/utils/state.ts";
import { resolveProfile } from "@features/profile/core/profile-ssr.ts";

/**
 * Profile-namespace middleware — resolves the public profile for a `/[handle]` request ONCE and stashes
 * it on `ctx.state.profile`, so the shared layout (shell · action lane · sticky header · meta rail) and
 * every tab sub-route read one projection with no repeated work. `null` means the first path segment is
 * a reserved route word (the denylist safeguard) or an unresolved handle — the layout then renders a
 * calm not-found instead of the profile chrome. Runs after the global `_middleware.ts` (which already
 * set `isAuthenticated` + `userContext`).
 */
export default define.middleware(async (ctx) => {
	// Prefer the routed param; fall back to the first path segment (robust if params aren't populated).
	const handle = ctx.params.handle ?? ctx.url.pathname.split("/").filter(Boolean)[0] ?? "";
	ctx.state.profile = resolveProfile(handle);
	if (ctx.state.profile) {
		ctx.state.handle = ctx.state.profile.handle;
		return ctx.next();
	}
	// Reserved route word / unresolved handle: the shared layout renders a calm not-found body, but the
	// response carries a real 404 status (the profile genuinely does not exist) rather than a soft 200.
	const res = await ctx.next();
	return new Response(res.body, { status: 404, headers: res.headers });
});
