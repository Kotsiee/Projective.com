import { define } from "@web/utils/state.ts";
import { serverEnv } from "@projective/backend/core/env.ts";
import { appleDomainAssociation } from "@server/services/finance/payment-method-domains.ts";

/**
 * `GET /.well-known/apple-developer-merchantid-domain-association` — Apple Pay's domain association
 * file (work order CK6), re-exported by `routes/(public)/.well-known/…`.
 *
 * Stripe's current payment-method-domain registration verifies Apple Pay without this file, so the
 * path answers 404 until a human sets `STRIPE_APPLE_PAY_DOMAIN_ASSOCIATION` because a domain's Apple
 * Pay status at Stripe asked for it (`deno task stripe:domains` prints that status). Then the body is
 * served verbatim as plain text, with no redirect and no session, which is what Apple fetches. It is
 * not a secret.
 */

// #region Response
/** The file, or a plain 404 while none is configured. */
export function associationResponse(body: string | null): Response {
	if (body === null) {
		return new Response("Not found", {
			status: 404,
			headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
		});
	}
	return new Response(body, {
		headers: {
			"content-type": "text/plain; charset=utf-8",
			"cache-control": "public, max-age=3600",
			"x-content-type-options": "nosniff",
		},
	});
}
// #endregion

export const handler = define.handlers({
	GET() {
		return associationResponse(appleDomainAssociation(serverEnv().stripeApplePayDomainAssociation));
	},
});
