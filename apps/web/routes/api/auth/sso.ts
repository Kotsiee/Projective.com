import { define } from "@web/utils/state.ts";
import { fieldErrors, SsoSchema } from "@features/auth/core/schema.ts";
import { safeRedirect, withRedirect } from "@features/auth/core/redirect.ts";
import { oauthStoreCookies } from "@web/utils/auth-cookies.ts";
import { AuthBackendService } from "@server/services/auth/AuthBackendService.ts";

/**
 * `POST /api/auth/sso` — Enterprise SSO discovery. Thin route: validate the corporate domain, then
 * delegate to the fat {@link AuthBackendService}, which (live) resolves the domain's registered
 * SAML/OIDC provider and returns its authorize URL. On success we persist the PKCE verifier cookie
 * and hand the island the external `ssoUrl` to navigate to; the IdP → GoTrue → `/api/auth/callback`
 * completes the exchange (the same callback OAuth uses). When no provider is configured the island
 * shows the returned message instead.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const body = await ctx.req.json().catch(() => null);
		if (!body) {
			return Response.json({ ok: false, message: "Invalid request body." }, { status: 400 });
		}

		const parsed = SsoSchema.safeParse(body);
		if (!parsed.success) {
			return Response.json({ ok: false, errors: fieldErrors(parsed.error) }, { status: 422 });
		}

		const redirectTo = safeRedirect(parsed.data.redirectTo);
		const callbackUrl =
			new URL(withRedirect("/api/auth/callback", redirectTo), ctx.url.origin).href;

		const { url, store, message } = await AuthBackendService.resolveSso({
			domain: parsed.data.domain,
			callbackUrl,
		});

		if (!url) {
			return Response.json({ ok: true, message }, { status: 200 });
		}

		const res = Response.json(
			{ ok: true, ssoUrl: url, message: "Redirecting to your identity provider…" },
			{ status: 200 },
		);
		// The verifier only needs to survive the trip to the IdP and back to /api/auth/callback.
		for (const cookie of oauthStoreCookies(store.diff(), 600)) {
			res.headers.append("set-cookie", cookie);
		}
		return res;
	},
});
