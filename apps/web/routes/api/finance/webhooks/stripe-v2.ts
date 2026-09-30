import { define } from "@web/utils/state.ts";
import { PaymentBackendService } from "@server/services/finance/PaymentBackendService.ts";

/**
 * `POST /api/finance/webhooks/stripe-v2` — the Accounts v2 THIN-event destination.
 *
 * Stripe publishes v2 events (a Connect account's recipient capability changing) only to a thin-payload
 * event destination of their own, never to the snapshot endpoint, so they arrive here with their own
 * signing secret (`STRIPE_THIN_WEBHOOK_SECRET`). A thin event carries only the account's id; the fat
 * {@link PaymentBackendService} re-reads the account from Stripe and applies its CURRENT status through
 * the service-role `finance.sync_payout_account` door — which keeps a freelancer's `payout_ready` and a
 * business's KYB in step.
 *
 * Same contract as the snapshot endpoint: the body is read RAW (the signature is an HMAC over the exact
 * bytes), 400 rejects a forged delivery, 5xx asks Stripe to redeliver, 2xx acknowledges.
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
		const result = await PaymentBackendService.handleStripeThinWebhook(
			payload,
			ctx.req.headers.get("stripe-signature"),
		);
		return Response.json(
			result.ok && result.data ? result.data : { received: false, message: result.message },
			{ status: result.status, headers: { "cache-control": "no-store" } },
		);
	},
});
