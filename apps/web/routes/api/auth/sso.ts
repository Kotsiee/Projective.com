import { define } from "@web/utils/state.ts";
import { fieldErrors, SsoSchema } from "@features/auth/core/schema.ts";
import { safeRedirect } from "@features/auth/core/redirect.ts";
import type { AuthResult } from "@features/auth/types/mod.ts";

function json(body: AuthResult, status = 200): Response {
	return Response.json(body, { status });
}

/**
 * `POST /api/auth/sso` — Enterprise SSO discovery. Given a corporate email domain, look up the
 * organization's configured SAML/OIDC identity provider and (in production) return the IdP redirect
 * URL to begin the handshake.
 *
 * MVP stub: shape-validates the domain and echoes a would-be provider redirect. When SSO lands this
 * queries the org's IdP config via @server/services and 302s to the provider's authorize endpoint.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const body = await ctx.req.json().catch(() => null);
		if (!body) return json({ ok: false, message: "Invalid request body." }, 400);

		const parsed = SsoSchema.safeParse(body);
		if (!parsed.success) return json({ ok: false, errors: fieldErrors(parsed.error) }, 422);

		// TODO(supabase/SSO): resolve the domain's IdP (SAML/OIDC) and return its authorize URL.
		return json({
			ok: true,
			message: `No SSO provider is configured for ${parsed.data.domain} yet.`,
			redirectTo: safeRedirect(parsed.data.redirectTo),
		});
	},
});
