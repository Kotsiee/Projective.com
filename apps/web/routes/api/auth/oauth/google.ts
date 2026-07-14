import { define } from "@web/utils/state.ts";
import { safeRedirect, withRedirect } from "@features/auth/core/redirect.ts";
import { oauthStoreCookies } from "@web/utils/auth-cookies.ts";
import { AuthBackendService } from "@server/services/auth/AuthBackendService.ts";

/**
 * `GET /api/auth/oauth/google` — Google OAuth entry point.
 *
 * Live (`AUTH_BACKEND_LIVE=true`): begin the Supabase Google PKCE handshake via the fat
 * {@link AuthBackendService}, persist the code-verifier as a short-lived cookie, and 303 to Google.
 * Google → GoTrue → `/api/auth/callback` completes the exchange.
 *
 * Non-live (default): simulate the "new Google identity → pre-filled `/join`" branch so the join
 * form's OAuth pre-fill UX is exercisable without a wired Google client. The avatar host is on the
 * OAuth allowlist (see `core/oauth.ts`).
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

		// Non-live simulation (or a start failure): pre-fill /join with a sample Google identity.
		const params = new URLSearchParams({
			oauth: "google",
			firstName: "Ada",
			lastName: "Lovelace",
			email: "ada.lovelace@gmail.com",
			avatar:
				"https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=128&h=128&fit=crop&crop=faces",
			redirectTo,
		});
		return new Response(null, { status: 303, headers: { location: `/join?${params.toString()}` } });
	},
});
