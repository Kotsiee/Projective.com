import { define } from "@web/utils/state.ts";
import { PaymentBackendService } from "@server/services/finance/PaymentBackendService.ts";

/**
 * `POST /api/finance/webhooks/stripe` — the Stripe webhook endpoint, and the only way a card payment
 * is ever settled, an identity verified, a transfer reconciled or a dispute recorded.
 *
 * Thin by contract, with one rule the rest of the routes do not need: the body is read RAW
 * (`req.text()`) and handed over untouched, because the `Stripe-Signature` header is an HMAC over the
 * exact bytes Stripe sent — a body that was parsed and re-serialised verifies as a forgery. The fat
 * {@link PaymentBackendService} verifies it (300 s tolerance, so an old delivery replayed by a third
 * party is refused), ignores what it does not handle, and applies the rest through service-role
 * `finance.*` doors that are idempotent on the event id.
 *
 * No session, no cookie, no CSRF concern: Stripe is the caller, and the signature is the credential.
 * The status is the contract Stripe acts on — 2xx acknowledges (including an event this endpoint
 * deliberately ignores), 400 rejects a forged or unsigned delivery, 5xx asks Stripe to redeliver.
 */
const MAX_BODY_BYTES = 1_048_576;

export const handler = define.handlers({
	async POST(ctx) {
		const declared = Number(ctx.req.headers.get("content-length") ?? "0");
		if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
			return Response.json({ received: false, message: "Payload too large." }, { status: 413 });
		}
		const payload = await ctx.req.text();
		if (payload.length > MAX_BODY_BYTES) {
			return Response.json({ received: false, message: "Payload too large." }, { status: 413 });
		}
		const result = await PaymentBackendService.handleStripeWebhook(
			payload,
			ctx.req.headers.get("stripe-signature"),
		);
		return Response.json(
			result.ok && result.data ? result.data : { received: false, message: result.message },
			{ status: result.status, headers: { "cache-control": "no-store" } },
		);
	},
});
