import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext, type UserContext } from "@projective/types/auth";
import { SaveBuyerDetailsSchema } from "@projective/types/finance";
import {
	invalidPayload,
	malformedBody,
	toCheckoutResponse,
} from "@features/checkout/core/respond.ts";
import { CheckoutBackendService } from "@server/services/finance/CheckoutBackendService.ts";
import { basketQueryFrom, basketQueryFromBody } from "@server/services/finance/basket-query.ts";

/**
 * `/api/checkout/details` — the buyer's delivery + billing record.
 *
 * `GET ?owner=&display=&persona=&workspaceRole=&kyb=&acting=&simDetails=&simBilling=&simInvoicing=`
 * returns the saved record for the active billing identity, every identity the viewer may bill
 * through, and the monthly-invoicing offer for the active one.
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
 * Thin: parse + Zod-validate + resolve the acting context + delegate to the fat
 * {@link CheckoutBackendService}. No server capability guard — the fat service enforces the member
 * gate (a non-member may not rewrite an entity's billing identity) and the deferred `finance.*` RLS
 * is the real gate, consistent with every sibling `/api/*` route.
 */

/** The slice of a request context the save path reads — structural, so both verbs share one body. */
interface SaveContext {
	req: Request;
	state: { userContext?: UserContext };
}

/** Validate and persist the whole record. Shared verbatim by `PUT` and its `POST` alias. */
async function saveDetails(ctx: SaveContext): Promise<Response> {
	const context = asAuthenticatedContext(ctx.state.userContext);
	const raw = await ctx.req.json().catch(() => null);
	if (raw === null || typeof raw !== "object") return malformedBody();
	const parsed = SaveBuyerDetailsSchema.safeParse(raw);
	if (!parsed.success) return invalidPayload(parsed.error);
	return toCheckoutResponse(
		CheckoutBackendService.saveDetails(
			parsed.data,
			basketQueryFromBody(raw as Record<string, unknown>, context),
		),
	);
}

export const handler = define.handlers({
	GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		return toCheckoutResponse(
			CheckoutBackendService.details(basketQueryFrom(ctx.url.searchParams, context)),
		);
	},

	PUT(ctx) {
		return saveDetails(ctx);
	},

	POST(ctx) {
		return saveDetails(ctx);
	},
});
