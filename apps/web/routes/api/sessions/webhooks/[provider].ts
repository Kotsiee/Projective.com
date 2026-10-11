import { define } from "@web/utils/state.ts";
import { SessionBackendService } from "@server/services/sessions/SessionBackendService.ts";

/**
 * `POST /api/sessions/webhooks/[provider]` — a conferencing provider's presence webhook (Decision #171).
 * `zoom` today (`meeting.participant_joined` / `meeting.participant_left`, and the
 * `endpoint.url_validation` handshake); another provider is another adapter in
 * `@server/services/sessions/presence/`, with no change here.
 *
 * Thin by contract, like the Stripe endpoint: the body is read RAW and handed over untouched, because
 * the provider's signature is an HMAC over the exact bytes it sent. No session and no cookie — the
 * provider is the caller and the signature is the credential. 2xx acknowledges (an ignored event too),
 * 400 refuses a forged or stale delivery, 404 an unknown provider, 503 asks for a redelivery.
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
		const result = await SessionBackendService.handlePresenceWebhook(
			ctx.params.provider,
			raw,
			ctx.req.headers,
		);
		const headers = { "cache-control": "no-store" };
		if (!result.ok || !result.data) {
			return Response.json({ received: false, message: result.message }, { status: result.status, headers });
		}
		// A provider handshake is answered with exactly the body the provider expects.
		if (result.data.challenge) return Response.json(result.data.challenge, { status: 200, headers });
		return Response.json({ received: true, outcomes: result.data.outcomes }, { status: 200, headers });
	},
});
