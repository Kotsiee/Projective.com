import { define } from "@web/utils/state.ts";
import { IntegrationsBackendService } from "@server/services/integrations/IntegrationsBackendService.ts";

/**
 * `POST /api/integrations/webhooks/[provider]` — the one provider webhook (Decision #343, ruling C4
 * (a)): presence, calendar pushes, Zoom's `endpoint.url_validation` and `app_deauthorized`, and
 * Graph's `validationToken` handshake. `/api/sessions/webhooks/[provider]` re-exports this handler
 * until the Zoom app's Event Subscription is re-pointed.
 *
 * Thin by contract, like the Stripe endpoint: the body is read RAW and handed over untouched, because
 * a provider's signature is an HMAC over the exact bytes it sent. No session and no cookie — the
 * provider is the caller and its proof is the credential. 2xx acknowledges (an ignored event and a
 * replay too), 400 refuses a forged or stale delivery, 404 an unknown provider, 503 asks for a
 * redelivery.
 */
const MAX_BODY_BYTES = 262_144;

export const handler = define.handlers({
	async POST(ctx) {
		const declared = Number(ctx.req.headers.get("content-length") ?? "0");
		if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
			return Response.json({ received: false, message: "Payload too large." }, { status: 413 });
		}
		const raw = await ctx.req.text();
		if (raw.length > MAX_BODY_BYTES) {
			return Response.json({ received: false, message: "Payload too large." }, { status: 413 });
		}
		const result = await IntegrationsBackendService.handleWebhook(
			ctx.params.provider,
			raw,
			ctx.req.headers,
			ctx.url,
		);
		const headers = { "cache-control": "no-store" };
		if (!result.ok || !result.data) {
			return Response.json({ received: false, message: result.message }, {
				status: result.status,
				headers,
			});
		}
		// A provider handshake is answered with exactly the body the provider expects.
		if (result.data.handshake) {
			return new Response(result.data.handshake, {
				status: 200,
				headers: {
					...headers,
					"content-type": "text/plain; charset=utf-8",
					"x-content-type-options": "nosniff",
				},
			});
		}
		if (result.data.challenge) {
			return Response.json(result.data.challenge, { status: 200, headers });
		}
		return Response.json({ received: true, outcomes: result.data.outcomes }, {
			status: 200,
			headers,
		});
	},
});
