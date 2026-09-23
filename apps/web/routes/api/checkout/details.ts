import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { SaveBuyerDetailsSchema } from "@projective/types/finance";
import {
	invalidPayload,
	malformedBody,
	toCheckoutResponse,
} from "@features/checkout/core/respond.ts";
import { CheckoutBackendService } from "@server/services/finance/CheckoutBackendService.ts";
import { basketQueryFrom, basketQueryFromBody } from "@server/services/finance/basket-query.ts";
import { readActor, type SessionContext } from "@web/utils/api-session.ts";

/**
 * `/api/checkout/details` — the buyer's delivery + billing record.
 *
 * `GET ?owner=&display=` returns the saved record for the paying account, every identity the viewer
 * may bill through, and the monthly-invoicing offer for the paying account.
 *
 * The save answers with the record AND the refreshed checkout session, because saving is what clears
 * the `missing_details` blocker: a response carrying only the record would leave the caller holding a
 * stale gate and needing a second round trip to discover it had opened.
 *
 * **`PUT` is the canonical verb** — the payload is the WHOLE record, saved as one atomic edit, which
 * is what `PUT` means and `PATCH` does not. `POST` is accepted as an alias for exactly one reason:
 * the shipped client transport (`features/checkout/core/api.ts`) publishes `POST` / `PATCH` /
 * `DELETE` and no `PUT`, and forking a second `fetch` path for one endpoint would be a worse trade
 * than answering to a second verb here. Both delegate to the same handler.
 *
 * Thin: parse + Zod-validate + resolve the acting context and session + delegate to the fat
 * {@link CheckoutBackendService}, which writes as the signed-in caller — `finance.buyer_details` RLS
 * (the account's spend predicate) is the gate.
 */

/** Validate and persist the whole record. Shared verbatim by `PUT` and its `POST` alias. */
async function saveDetails(ctx: SessionContext): Promise<Response> {
	const context = asAuthenticatedContext(ctx.state.userContext);
	const raw = await ctx.req.json().catch(() => null);
	if (raw === null || typeof raw !== "object") return malformedBody();
	const parsed = SaveBuyerDetailsSchema.safeParse(raw);
	if (!parsed.success) return invalidPayload(parsed.error);
	return toCheckoutResponse(
		await CheckoutBackendService.saveDetails(
			parsed.data,
			basketQueryFromBody(raw as Record<string, unknown>, context),
			readActor(ctx),
		),
	);
}

export const handler = define.handlers({
	async GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		return toCheckoutResponse(
			await CheckoutBackendService.details(
				basketQueryFrom(ctx.url.searchParams, context),
				readActor(ctx),
			),
		);
	},

	PUT(ctx) {
		return saveDetails(ctx);
	},

	POST(ctx) {
		return saveDetails(ctx);
	},
});
