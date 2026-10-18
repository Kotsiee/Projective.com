import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { ensureSession } from "@web/utils/session.ts";
import { resolveTokenContext } from "@web/utils/user-context.ts";
import { resolveProfile } from "@features/profile/core/profile-ssr.ts";
import {
	applyBusinessPageSim,
	BUSINESS_PAGE_SIM_COOKIE,
	parseBusinessPageSim,
} from "@features/profile/core/business-page-sim.ts";
import { readCookies } from "@web/utils/auth-cookies.ts";
import { IS_DEV } from "@web/utils/dev.ts";

/**
 * Profile-namespace middleware — resolves the profile for a `/[handle]` request ONCE and stashes it
 * on `ctx.state.profile`, so the shared layout and every section sub-route read one projection.
 *
 * The read is made AS THE VIEWER: the database decides whether they may see the profile at all (a
 * private one is invisible to everyone but its owner) and whether they own it (`viewer.isOwner`,
 * which unlocks the owner sub-nav and the edit routes). So before reading, an expired session is
 * renewed in place when a refresh cookie remains — the same refresh-before-redirect move the
 * dashboard guard makes, minus the redirect: a guest may read a public profile, but an owner whose
 * access token lapsed while they were away must still be recognised as the owner on their next load.
 *
 * `null` means a reserved route word, an unknown handle or a profile the viewer may not see — the
 * layout renders a calm not-found and the response carries a real 404. A profile that could not be
 * read at all (the database is down) is a 503, and says so, rather than claiming the profile does
 * not exist.
 *
 * In development only, the Dev Context Switcher's business page state (`pj.dev.business-page`,
 * Decision #244) is laid over a business's read here — once, so the layout and every section agree:
 * a member's hidden reason, or the outsider's 404.
 */
export default define.middleware(async (ctx) => {
	// Prefer the routed param; fall back to the first path segment (robust if params aren't populated).
	const handle = ctx.params.handle ?? ctx.url.pathname.split("/").filter(Boolean)[0] ?? "";

	const session = await ensureSession(ctx.req);
	if (session.authenticated && session.accessToken) {
		ctx.state.accessToken = session.accessToken;
		if (session.refreshed) {
			ctx.state.isAuthenticated = true;
			ctx.state.userContext = resolveTokenContext(session.accessToken);
		}
	}

	const resolved = await resolveProfile(handle, readActor(ctx));
	const sim = IS_DEV ? parseBusinessPageSim(readCookies(ctx.req)[BUSINESS_PAGE_SIM_COOKIE]) : null;
	const profile = applyBusinessPageSim(resolved.profile, sim);
	const status = resolved.profile && !profile ? 404 : resolved.status;
	ctx.state.profile = profile;
	ctx.state.profileStatus = status;
	if (profile) ctx.state.handle = profile.handle;

	const res = await ctx.next();
	// Mint a renewed session onto the response (or clear a dead one) — empty on the fast path.
	for (const cookie of session.setCookies) res.headers.append("set-cookie", cookie);
	for (const cookie of session.clearCookies) res.headers.append("set-cookie", cookie);
	if (profile) return res;
	// Reserved word / unknown / hidden → 404; unreadable → 503. The layout renders the matching body.
	return new Response(res.body, { status, headers: res.headers });
});
