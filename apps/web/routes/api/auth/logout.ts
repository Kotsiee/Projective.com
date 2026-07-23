import { define } from "@web/utils/state.ts";
import { readCookies, SB_ACCESS_COOKIE, sessionClearCookies } from "@web/utils/auth-cookies.ts";
import { AuthBackendService } from "@server/services/auth/AuthBackendService.ts";

/**
 * `POST /api/auth/logout` — end the session.
 *
 * The client {@link AuthService}.logout() posts here, then applies its route-aware redirect. This thin
 * route lifts the access token from the HttpOnly `sb-access-token` cookie, delegates to the fat
 * {@link AuthBackendService} for a best-effort GoTrue revocation, and — unconditionally — clears both
 * `sb-*` session cookies. Cookie clearing is the authoritative sign-out: once the browser can no longer
 * present a session, the `(dashboard)` guard bounces and every RLS-scoped read is denied. Always 200,
 * even if revocation failed, so the UI can proceed to redirect without a dead-end.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const accessToken = readCookies(ctx.req)[SB_ACCESS_COOKIE];
		await AuthBackendService.signOut({ accessToken });

		const res = Response.json({ ok: true }, { status: 200 });
		for (const cookie of sessionClearCookies()) res.headers.append("set-cookie", cookie);
		return res;
	},
});
