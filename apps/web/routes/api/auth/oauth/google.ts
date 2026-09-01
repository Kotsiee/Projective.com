import { define } from "@web/utils/state.ts";
import { safeRedirect, withRedirect } from "@features/auth/core/redirect.ts";
import { oauthSimulationTarget } from "@features/auth/core/auth-routing.ts";
import { oauthStoreCookies } from "@web/utils/auth-cookies.ts";
import { AuthBackendService } from "@server/services/auth/AuthBackendService.ts";

/**
 * `GET /api/auth/oauth/google` — Google OAuth entry point.
 *
 * Live (`AUTH_BACKEND_LIVE=true`): begin the Supabase Google PKCE handshake via the fat
 * {@link AuthBackendService}, persist the code-verifier as a short-lived cookie, and 303 to Google.
 * Google → GoTrue → `/api/auth/callback` completes the exchange, which resolves new-vs-returning from
 * the database — the `mode` param is not consulted there, because a real profile lookup outranks
 * which button was pressed.
 *
 * Non-live (default): there is no identity to look up, so {@link oauthSimulationTarget} branches on
 * `mode` — a sign-in returns to its captured path, only a sign-up simulates the new-identity bounce
 * to a pre-filled `/join`.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const redirectTo = safeRedirect(ctx.url.searchParams.get("redirectTo"));
		const callbackUrl =
			new URL(withRedirect("/api/auth/callback", redirectTo), ctx.url.origin).href;

		const { url, store } = await AuthBackendService.startGoogleOAuth({ callbackUrl });
		if (url) {
			const res = new Response(null, { status: 303, headers: { location: url } });
			// The verifier only needs to survive the trip to Google and back.
			for (const cookie of oauthStoreCookies(store.diff(), 600)) {
				res.headers.append("set-cookie", cookie);
			}
			return res;
		}

		// Non-live simulation, or a start failure with nowhere real to send them.
		const location = oauthSimulationTarget(ctx.url.searchParams);
		return new Response(null, { status: 303, headers: { location } });
	},
});
