import { define } from "@web/utils/state.ts";
import { readCookies, SB_REFRESH_COOKIE, sessionClearCookies } from "@web/utils/auth-cookies.ts";
import { toAuthResponse } from "@features/auth/core/respond.ts";
import { authSubject, refuseIfThrottled } from "@features/auth/core/throttle.ts";
import { AuthBackendService } from "@server/services/auth/AuthBackendService.ts";

/**
 * `POST /api/auth/refresh` — silent session renewal for the client 401-interceptor.
 *
 * Reads the HttpOnly `sb-refresh-token` cookie and delegates to the fat {@link AuthBackendService},
 * which (live) runs the GoTrue refresh grant. On success the renewed `sb-*` session cookies are minted
 * onto the response (kept OUT of the JSON body), with the lifetime the sign-in chose (Decision #201),
 * so the browser's next request is authenticated, and
 * the client retries its original call seamlessly. With no refresh cookie, or when GoTrue refuses the
 * grant (spent/revoked token), it returns a clean 401 and clears the dead session so the client can
 * route to sign-in. When GoTrue cannot be reached or fails, it returns a 503 and leaves the cookies
 * alone: the token may still be good, and an outage must never sign anyone out.
 *
 * Deliberately NOT behind the `(dashboard)` guard (it must be reachable precisely when the access
 * token has expired). It is idempotent-safe and rotates the refresh token when live.
 */
function unauthorized(req: Request): Response {
	const res = Response.json(
		{ ok: false, message: "Your session has expired. Please sign in again." },
		{ status: 401 },
	);
	for (const cookie of sessionClearCookies(req)) res.headers.append("set-cookie", cookie);
	return res;
}

function unavailable(message?: string): Response {
	return Response.json(
		{
			ok: false,
			message: message ?? "We couldn't renew your session right now. Try again shortly.",
		},
		{ status: 503 },
	);
}

export const handler = define.handlers({
	async POST(ctx) {
		const refresh = readCookies(ctx.req)[SB_REFRESH_COOKIE];
		if (!refresh) return unauthorized(ctx.req);

		// A throttled renewal leaves the cookies alone, like an outage: the token may still be good.
		const refused = refuseIfThrottled(
			ctx.req,
			"refresh",
			authSubject(ctx.req, ctx.info.remoteAddr),
		);
		if (refused) return refused;

		const result = await AuthBackendService.refreshSession(refresh);
		if (!result.ok || !result.session) {
			return result.status === 401 ? unauthorized(ctx.req) : unavailable(result.message);
		}

		// toAuthResponse mints the fresh sb-* cookies from result.session; body is just { ok: true }.
		return toAuthResponse(ctx.req, result);
	},
});
