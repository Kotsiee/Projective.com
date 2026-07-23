import { define } from "@web/utils/state.ts";
import { readCookies, SB_REFRESH_COOKIE, sessionClearCookies } from "@web/utils/auth-cookies.ts";
import { toAuthResponse } from "@features/auth/core/respond.ts";
import { AuthBackendService } from "@server/services/auth/AuthBackendService.ts";

/**
 * `POST /api/auth/refresh` — silent session renewal for the client 401-interceptor.
 *
 * Reads the HttpOnly `sb-refresh-token` cookie and delegates to the fat {@link AuthBackendService},
 * which (live) runs the GoTrue refresh grant. On success the renewed `sb-*` session cookies are minted
 * onto the response (kept OUT of the JSON body) so the browser's next request is authenticated, and
 * the client retries its original call seamlessly. On failure — or with no refresh cookie — it returns
 * a clean 401 and clears the dead session so the client can route to sign-in.
 *
 * Deliberately NOT behind the `(dashboard)` guard (it must be reachable precisely when the access
 * token has expired). It is idempotent-safe and rotates the refresh token when live.
 */
function unauthorized(): Response {
	const res = Response.json(
		{ ok: false, message: "Your session has expired. Please sign in again." },
		{ status: 401 },
	);
	for (const cookie of sessionClearCookies()) res.headers.append("set-cookie", cookie);
	return res;
}

export const handler = define.handlers({
	async POST(ctx) {
		const refresh = readCookies(ctx.req)[SB_REFRESH_COOKIE];
		if (!refresh) return unauthorized();

		const result = await AuthBackendService.refreshSession(refresh);
		if (!result.ok || !result.session) return unauthorized();

		// toAuthResponse mints the fresh sb-* cookies from result.session; body is just { ok: true }.
		return toAuthResponse(result);
	},
});
