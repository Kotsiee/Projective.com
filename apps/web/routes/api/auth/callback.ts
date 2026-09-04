import { define } from "@web/utils/state.ts";
import { readRedirect, withRedirect } from "@features/auth/core/redirect.ts";
import { joinCompletionTarget } from "@features/auth/core/auth-routing.ts";
import { oauthStoreCookies, readCookies, sessionSetCookies } from "@web/utils/auth-cookies.ts";
import { AuthBackendService } from "@server/services/auth/AuthBackendService.ts";

/** A 303 redirect with optional `Set-Cookie`s. */
function redirect(location: string, cookies: string[] = []): Response {
	const res = new Response(null, { status: 303, headers: { location } });
	for (const cookie of cookies) res.headers.append("set-cookie", cookie);
	return res;
}

/**
 * `GET /api/auth/callback` — the OAuth return leg. Google → GoTrue redirect here with a `code`; the
 * fat {@link AuthBackendService} exchanges it (using the round-tripped PKCE verifier from cookies)
 * for a session. On success we mint the `sb-*` session cookies and route:
 *  - a **new** Google identity (no Projective profile yet) → `/join` pre-filled to finish onboarding
 *    (they're already authenticated, so `/join` completes via `complete_onboarding`);
 *  - an **existing** user → their captured return path.
 * The spent verifier cookie is always cleared. Failures land on `/login?notice=oauth_failed`.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const redirectTo = readRedirect(ctx.url.searchParams);
		const code = ctx.url.searchParams.get("code");
		const oauthError = ctx.url.searchParams.get("error_description") ??
			ctx.url.searchParams.get("error");

		if (oauthError || !code) {
			return redirect(withRedirect("/login?notice=oauth_failed", redirectTo));
		}

		const result = await AuthBackendService.exchangeOAuthCode({
			code,
			cookies: readCookies(ctx.req),
		});
		// Clear the spent verifier cookie(s) regardless of outcome.
		const clearVerifier = oauthStoreCookies(result.store.diff(), 0);

		if (result.error || !result.session) {
			return redirect(withRedirect("/login?notice=oauth_failed", redirectTo), clearVerifier);
		}

		const cookies = [...clearVerifier, ...sessionSetCookies(result.session)];

		if (result.isNewUser) {
			// Through the shared builder, because this is not the only place that address gets built:
			// the dashboard guard sends the same identity back here if they abandon the form, and two
			// hand-rolled copies of one URL is how the `oauth` marker goes missing from one of them.
			return redirect(
				joinCompletionTarget({ provider: "google", ...result.identity }, redirectTo),
				cookies,
			);
		}

		return redirect(redirectTo, cookies);
	},
});
