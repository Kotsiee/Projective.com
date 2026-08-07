import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import {
	AddBasketItemSchema,
	RemoveBasketItemSchema,
	UpdateBasketItemSchema,
} from "@projective/types/finance";
import {
	invalidPayload,
	malformedBody,
	toCheckoutResponse,
} from "@features/checkout/core/respond.ts";
import { BasketBackendService } from "@server/services/finance/BasketBackendService.ts";
import { basketQueryFromBody } from "@server/services/finance/basket-query.ts";

/**
 * `/api/basket/item` — one basket line.
 *
 * - `POST` — add a purchasable ({@link AddBasketItemSchema}). A `null` `basketId` lands in the acting
 *   account's default basket, so an add-to-basket from anywhere on the platform needs no prior lookup.
 * - `PATCH` — patch a line ({@link UpdateBasketItemSchema}): quantity, selection, parking, delivery
 *   address, booked slot, routed stage or seats.
 * - `DELETE` — remove a line ({@link RemoveBasketItemSchema}); soft server-side, nothing is destroyed.
 *
 * Thin: parse + Zod-validate (mapping issues to field errors) + resolve the acting context + delegate.
 * Every response is the SAME shape a `GET /api/basket` returns, so the client replaces its state
 * wholesale rather than patching a total by hand. No server capability guard — the Dev Context Switcher
 * must reach every persona; the fat service enforces the member gate and the deferred `finance.*` RLS
 * is the real gate.
 */

/** Read + shape a JSON body, tolerating a DELETE that carries its id in the query string instead. */
async function body(req: Request, url: URL): Promise<Record<string, unknown> | null> {
	const raw = await req.json().catch(() => null);
	if (raw !== null && typeof raw === "object") return raw as Record<string, unknown>;
	const fromQuery = url.searchParams.get("basketItemId");
	return fromQuery ? { basketItemId: fromQuery } : null;
}

export const handler = define.handlers({
	async POST(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const raw = await ctx.req.json().catch(() => null);
		if (raw === null || typeof raw !== "object") return malformedBody();
		const parsed = AddBasketItemSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);
		return toCheckoutResponse(
			BasketBackendService.addItem(
				parsed.data,
				basketQueryFromBody(raw as Record<string, unknown>, context),
			),
		);
	},

	async PATCH(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const raw = await ctx.req.json().catch(() => null);
		if (raw === null || typeof raw !== "object") return malformedBody();
		const parsed = UpdateBasketItemSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);
		return toCheckoutResponse(
			BasketBackendService.updateItem(
				parsed.data,
				basketQueryFromBody(raw as Record<string, unknown>, context),
			),
		);
	},

	async DELETE(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const raw = await body(ctx.req, ctx.url);
		if (raw === null) return malformedBody();
		const parsed = RemoveBasketItemSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);
		return toCheckoutResponse(
			BasketBackendService.removeItem(parsed.data, basketQueryFromBody(raw, context)),
		);
	},
});
