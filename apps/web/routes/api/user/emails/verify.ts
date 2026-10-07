import { define } from "@web/utils/state.ts";
import { ensureSession } from "@web/utils/session.ts";
import { sessionClearCookies } from "@web/utils/auth-cookies.ts";
import { resolveTokenContext } from "@web/utils/user-context.ts";
import { withRedirect } from "@features/auth/core/redirect.ts";
import { actorFrom } from "@server/services/read-actor.ts";
import { EmailsBackendService } from "@server/services/user/EmailsBackendService.ts";

/**
 * `GET /api/user/emails/verify?token=…` — the link in a confirmation email.
 *
 * Redeems the token for the SIGNED-IN account and lands on `/settings/account?email=<outcome>`, the
 * outcome being one of `EmailVerifyOutcome` (`verified` · `expired` · `invalid` · `used` ·
 * `wrong-account` · `in-use`). A signed-out visitor is sent to `/login?redirectTo=<this url>` and
 * comes back here after signing in — the token only ever redeems for the account it was issued to.
 *
 * Unlike the other `/api/user/*` routes this is a browser NAVIGATION, not a `fetch`, so there is no
 * client interceptor to refresh a lapsed session: the route renews it itself ({@link ensureSession},
 * the dashboard guard's refresh-before-redirect) and mints the renewed cookies on the way out. A
 * session the database still refuses is cleared before the bounce, or `/login` (which forwards a
 * signed-in visitor to `redirectTo`) would send it straight back here.
 *
 * ⚠️ When the server cannot be reached the token is left unredeemed and the landing is
 * `?email=unavailable` — a value OUTSIDE `EmailVerifyOutcome`, flagged for the settings console.
 */

/** Where every outcome lands. */
const SETTINGS = "/settings/account";

/** A 303 to `location`, carrying any session cookies; never cached (the URL holds a credential). */
function seeOther(location: string, cookies: string[] = []): Response {
	const res = new Response(null, {
		status: 303,
		headers: { location, "cache-control": "no-store", "referrer-policy": "no-referrer" },
	});
	for (const cookie of cookies) res.headers.append("set-cookie", cookie);
	return res;
}

export const handler = define.handlers({
	async GET(ctx) {
		const here = ctx.url.pathname + ctx.url.search;
		const session = await ensureSession(ctx.req);
		const actor = actorFrom(resolveTokenContext(session.accessToken), session.accessToken);
		if (!session.authenticated || !actor.userId) {
			return seeOther(withRedirect("/login", here), session.clearCookies);
		}

		const token = ctx.url.searchParams.get("token")?.trim() ?? "";
		if (token.length === 0 || token.length > 256) {
			return seeOther(`${SETTINGS}?email=invalid`, session.setCookies);
		}

		const result = await EmailsBackendService.confirm(actor, token);
		if (result.ok && result.data) {
			return seeOther(`${SETTINGS}?email=${result.data.outcome}`, session.setCookies);
		}
		if (result.status === 401) {
			return seeOther(withRedirect("/login", here), sessionClearCookies());
		}
		return seeOther(`${SETTINGS}?email=unavailable`, session.setCookies);
	},
});
