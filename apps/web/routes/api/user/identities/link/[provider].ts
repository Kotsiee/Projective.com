import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { withRedirect } from "@features/auth/core/redirect.ts";
import { oauthStoreCookies, readCookies, SB_REFRESH_COOKIE } from "@web/utils/auth-cookies.ts";
import { SignInProvider } from "@projective/types/auth";
import { IdentitiesBackendService } from "@server/services/auth/IdentitiesBackendService.ts";

/** Where the person lands back in Settings, with the outcome in `?connect=`. */
function settingsTarget(outcome: string): string {
	return `/settings/account?connect=${encodeURIComponent(outcome)}#connected-accounts`;
}

/**
 * `GET /api/user/identities/link/[provider]` — start connecting a sign-in provider. A PKCE handshake
 * like sign-in: the provider's authorize URL is minted against the caller's own session, ONLY the
 * code-verifier is set as a short-lived cookie, and the shared `/api/auth/callback` completes the
 * exchange and returns the person to Settings → Account. A refusal returns there at once with
 * `?connect=failed`.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const provider = SignInProvider.safeParse(ctx.params.provider);
		if (!provider.success) {
			return new Response(null, { status: 303, headers: { location: settingsTarget("failed") } });
		}
		const callbackUrl = new URL(
			withRedirect("/api/auth/callback", settingsTarget(provider.data)),
			ctx.url.origin,
		).href;
		const result = await IdentitiesBackendService.startLink(readActor(ctx), {
			provider: provider.data,
			refreshToken: readCookies(ctx.req)[SB_REFRESH_COOKIE] ?? null,
			callbackUrl,
		});
		if (!result.ok || !result.data) {
			return new Response(null, { status: 303, headers: { location: settingsTarget("failed") } });
		}
		const res = new Response(null, { status: 303, headers: { location: result.data.url } });
		const verifier = result.data.store.diff().filter(({ key }) => key.endsWith("-code-verifier"));
		for (const cookie of oauthStoreCookies(verifier, 600)) res.headers.append("set-cookie", cookie);
		return res;
	},
});
