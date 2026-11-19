import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { readActor } from "@web/utils/api-session.ts";
import { invalidBody, serviceResponse } from "@web/utils/service-response.ts";
import { SavedListToBasketSchema } from "@projective/types/org";
import { SavedBackendService } from "@server/services/saved/SavedBackendService.ts";
import { basketQueryFromBody } from "@server/services/finance/basket-query.ts";

/**
 * `POST /api/saved/collections/:id/basket` — put one list's purchasable items into a basket:
 * `{ basketId }` (an existing one, `null` = the default) or `{ newBasketName }` (a new named one).
 * Answers what was added and what needs a step on its own page.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		const raw = await ctx.req.json().catch(() => null);
		if (raw === null || typeof raw !== "object") return invalidBody("form", "Check the request.");
		const parsed = SavedListToBasketSchema.safeParse(raw);
		if (!parsed.success) {
			const issue = parsed.error.issues[0];
			return invalidBody(
				issue?.path.map(String).join(".") || "form",
				issue?.message ?? "Check the request.",
			);
		}
		return serviceResponse(
			await SavedBackendService.listToBasket(
				ctx.params.id,
				parsed.data,
				basketQueryFromBody(raw as Record<string, unknown>, context),
				readActor(ctx),
			),
		);
	},
});
