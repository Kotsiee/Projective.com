import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { toCheckoutResponse } from "@features/checkout/core/respond.ts";
import { CheckoutBackendService } from "@server/services/finance/CheckoutBackendService.ts";
import { basketQueryFrom } from "@server/services/finance/basket-query.ts";
import { readActor } from "@web/utils/api-session.ts";

/**
 * `GET /api/checkout/session?basketId=&owner=&display=&project_id=&service_id=&googlePay=&applePay=
 * &paypal=` — the checkout page's entire server projection.
 *
 * One read returns which account is paying, which lines it is paying for, the server-computed groups
 * and totals, what each of the six payment providers costs the buyer in eligibility (with a reason on
 * every refusal — a refused provider is rendered and disabled, never omitted), what the wallet covers,
 * the cards on file, and everything currently blocking Pay.
 *
 * `googlePay` / `applePay` / `paypal` are the client's own capability sniff, which the SSOT's
 * `ProviderContext` takes as inputs — used only once a payment processor is connected to take them.
 *
 * Thin: resolve the acting context, the session and the query, then delegate to the fat
 * {@link CheckoutBackendService}, which reads as the signed-in caller — `finance.*` RLS is the gate.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		return toCheckoutResponse(
			await CheckoutBackendService.session(
				basketQueryFrom(ctx.url.searchParams, context),
				readActor(ctx),
			),
		);
	},
});
