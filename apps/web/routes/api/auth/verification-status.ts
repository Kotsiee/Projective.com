import { define } from "@web/utils/state.ts";
import { safeRedirect } from "@features/auth/core/redirect.ts";
import { toAuthResponse } from "@features/auth/core/respond.ts";
import { PENDING_VERIFICATION_COOKIE, readCookies } from "@web/utils/auth-cookies.ts";
import { AuthBackendService } from "@server/services/auth/AuthBackendService.ts";

/** The caller's transport address, the rate-limit key for a poll no valid cookie names. */
function clientKey(remote: Deno.Addr): string {
	return "hostname" in remote ? remote.hostname : remote.transport;
}

/**
 * `GET /api/auth/verification-status?redirectTo=` — the `/verify` page's confirmation poll (Decision
 * #185). Thin route: it hands the fat {@link AuthBackendService} the signed, HttpOnly
 * pending-verification cookie that `POST /api/auth/join` (or an unconfirmed sign-in) set in this
 * browser, and the service answers only for the account that cookie names. No cookie, a foreign or
 * expired one, or a still-pending account all get the same `{ verified: false }`; an `email` query
 * parameter is ignored, so the endpoint reveals nothing about which addresses have accounts. Polls
 * are rate-limited (429).
 *
 * It never signs anyone in. When the account is confirmed it reports `signedIn`: `true` when this
 * request already carries a verified session (the code was entered, or the email link was opened in this
 * browser) so the page continues in, `false` when the link was opened elsewhere so the page asks the
 * reader to sign in.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const result = await AuthBackendService.getVerificationStatus({
			pendingToken: readCookies(ctx.req)[PENDING_VERIFICATION_COOKIE],
			clientKey: clientKey(ctx.info.remoteAddr),
			hasSession: ctx.state.isAuthenticated === true,
			redirectTo: safeRedirect(ctx.url.searchParams.get("redirectTo")),
		});
		const res = toAuthResponse(ctx.req, result);
		res.headers.set("cache-control", "no-store");
		return res;
	},
});
