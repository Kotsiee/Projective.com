import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { toCheckoutResponse } from "@features/checkout/core/respond.ts";
import { CheckoutBackendService } from "@server/services/finance/CheckoutBackendService.ts";
import { basketQueryFrom } from "@server/services/finance/basket-query.ts";

/**
 * `GET /api/checkout/session?basketId=&owner=&display=&project_id=&service_id=&persona=&workspaceRole=
 * &kyb=&acting=&googlePay=&applePay=&paypal=` — the checkout page's entire server projection.
 *
 * One read returns which account is paying, which lines it is paying for, the server-computed groups
 * and totals, what each of the six payment providers costs the buyer in eligibility (with a reason on
 * every refusal — a refused provider is rendered and disabled, never omitted), what the wallet covers,
 * the cards on file, and everything currently blocking Pay.
 *
 * `googlePay` / `applePay` are the client's own device-capability sniff, which the SSOT's
 * `ProviderContext.deviceWallets` takes as an input; `persona` / `workspaceRole` / `kyb` / `acting`
 * mirror existing Dev Context Switcher axes, which the server cannot read from the client seam and so
 * travel as validated query params (the `/wallet` precedent).
 *
 * Thin: resolve the acting context + the query, then delegate to the fat
 * {@link CheckoutBackendService}. No server capability guard — the Dev Context Switcher must reach
 * every persona; the fat service enforces the member gate, the verification gate and the provider
 * rules, and the deferred `finance.*` RLS is the real gate.
 */
export const handler = define.handlers({
	GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		return toCheckoutResponse(
			CheckoutBackendService.session(basketQueryFrom(ctx.url.searchParams, context)),
		);
	},
});
