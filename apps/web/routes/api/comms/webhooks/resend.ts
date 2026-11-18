import { define } from "@web/utils/state.ts";
import { DeliveryEventService } from "@server/services/comms/DeliveryEventService.ts";

/**
 * `POST /api/comms/webhooks/resend` — the email provider's delivery webhook (COMMS NT3; providers spec
 * §8.5 setup 6). Thin by contract, like the Stripe and Zoom endpoints: the body is read RAW, capped at
 * 256 KiB (on `Content-Length`, then on the bytes read), and handed over untouched, because the Svix
 * signature is an HMAC over the exact bytes sent. No session and no cookie. 2xx acknowledges (a replay
 * and an ignored event too), 400 refuses a forged or stale delivery, 413 an oversized one, 503 asks
 * for a redelivery ({@link DeliveryEventService.handleResend}). A server-to-server door
 * (`/api/…/webhooks/…`), so the `/api` origin guard stands aside.
 */
const MAX_BODY_BYTES = 262_144;

export const handler = define.handlers({
	async POST(ctx) {
		const headers = { "cache-control": "no-store" };
		const declared = Number(ctx.req.headers.get("content-length") ?? "0");
		if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
			return Response.json({ received: false, message: "Payload too large." }, {
				status: 413,
				headers,
			});
		}
		const bytes = new Uint8Array(await ctx.req.arrayBuffer());
		if (bytes.byteLength > MAX_BODY_BYTES) {
			return Response.json({ received: false, message: "Payload too large." }, {
				status: 413,
				headers,
			});
		}
		const result = await DeliveryEventService.handleResend(
			new TextDecoder().decode(bytes),
			ctx.req.headers,
		);
		return result.ok && result.data
			? Response.json(result.data, { status: 200, headers })
			: Response.json({ received: false, message: result.message }, {
				status: result.status,
				headers,
			});
	},
});
