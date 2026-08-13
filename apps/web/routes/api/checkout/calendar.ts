import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { OrderBackendService } from "@server/services/finance/OrderBackendService.ts";
import { basketQueryFrom } from "@server/services/finance/basket-query.ts";

/**
 * `GET /api/checkout/calendar?order=&line=` — the `.ics` file for one booked line of one order.
 *
 * **The one route on this surface that does not answer with the `CheckoutResponse` envelope**: it
 * returns a FILE, not JSON, because that is what a calendar client consumes. It is reached from a
 * plain anchor `href` on the confirmation hub and therefore does NOT ride the client's `apiFetch`
 * interceptor — a browser follows the link itself.
 *
 * The document is built by the SSOT's `buildIcsCalendar` (RFC 5545 escaping and folding already
 * handled there), from the same event the Google and Outlook links beside it are built from, so a
 * buyer who adds the booking twice from two different buttons gets one event rather than two that
 * disagree about the time. Its `DTSTAMP` is fixed, so the bytes are identical on every request and a
 * calendar can de-duplicate by `UID` instead of stacking copies.
 *
 * `nosniff` is set because the response is user-influenced content served as a document type: without
 * it a browser is free to re-interpret the body as something it was never meant to be. The filename
 * travels in `content-disposition` so the file lands named after the order, not after the route.
 *
 * Thin: resolve the acting context + the two ids, delegate, and map the outcome onto a file or a
 * plain-text `404`. The fat service scopes the order to the acting account — a calendar entry names a
 * seller, a time and a join link, so an id in a URL must not be enough to read one.
 */
export const handler = define.handlers({
	GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const sp = ctx.url.searchParams;
		const orderId = sp.get("order");
		const lineId = sp.get("line");
		if (!orderId || !lineId) {
			return new Response("Missing order or line.", {
				status: 400,
				headers: { "content-type": "text/plain; charset=utf-8" },
			});
		}

		const result = OrderBackendService.ics(orderId, lineId, {
			...basketQueryFrom(sp, context),
			orderId,
		});
		if (!result.ok || !result.data) {
			return new Response(result.message ?? "That booking doesn't have a calendar entry.", {
				status: result.status,
				headers: { "content-type": "text/plain; charset=utf-8" },
			});
		}

		return new Response(result.data.body, {
			status: 200,
			headers: {
				"content-type": "text/calendar; charset=utf-8",
				"content-disposition": `attachment; filename="${result.data.filename}"`,
				"x-content-type-options": "nosniff",
				// A receipt's calendar entry is per-account and must never sit in a shared cache.
				"cache-control": "private, no-store",
			},
		});
	},
});
