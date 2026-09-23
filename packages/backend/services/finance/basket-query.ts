import type { UserContext } from "@projective/types/auth";
import type { CheckoutQuery } from "@projective/types/finance";

/**
 * basket-query — the resolved read shape for every `/api/basket/*`, `/api/checkout/*` and `/api/cards/*`
 * route, plus the parser that builds it from a request.
 *
 * **Why the parser is server-side rather than in a feature `core/`.** The basket read shape belongs to
 * the service that consumes it, so it lives beside the fat services and the thin routes import it
 * through the `@server/services/*` alias.
 *
 * **What a request may say, and what it may not.** A query names WHICH basket, WHOSE money (the
 * `owner` scope), which currency to read it in, and which deep link to narrow to. It never names who
 * the caller is — the identity the live reads run under is the session's `ReadActor`, passed beside
 * the query rather than inside it, so a request field can never be mistaken for an identity.
 *
 * **Capabilities, not simulations.** Device-wallet and PayPal availability are genuine facts the
 * client sniffs (a browser either offers Google Pay or it does not) or the deployment configures, and
 * the SSOT's `ProviderContext.deviceWallets` / `paypalEnabled` take them as inputs for exactly that
 * reason. They ride the query string because they have the same shape. The fixture-era simulation
 * axes (persona, workspace role, KYB, wallet coverage, saved-card shape, details state …) are gone:
 * every one of those facts is now read from the database, and a query param that could override one
 * would be a way to lie to the checkout about the account paying.
 */

// #region Capabilities
/** Client-sniffed payment capabilities — inputs to the SSOT's `availableProviders`, never overrides. */
export interface BasketCapabilities {
	/** Whether this browser offers Google Pay. */
	googlePay?: boolean;
	/** Whether this device offers Apple Pay. */
	applePay?: boolean;
	/** Whether PayPal is configured for this deployment. */
	paypalEnabled?: boolean;
}
// #endregion

// #region Resolved query
/**
 * A resolved basket/checkout read: which basket, whose money, in which currency, narrowed to which
 * deep link.
 *
 * Extends the SSOT's {@link CheckoutQuery}; every added member is optional, so a bare `CheckoutQuery`
 * is still assignable.
 */
export interface BasketQuery extends CheckoutQuery {
	/**
	 * The viewer's preferred display currency (from the chrome context). The fallback after an explicit
	 * `?display=` and the account's own currency.
	 */
	viewerCurrency?: string | null;
	/**
	 * The payment route the buyer has selected, when they have.
	 *
	 * Read only to decide whether the gateway-contribution offer applies at all: a wallet or invoice
	 * payment moves no money through a card scheme, so asking the buyer to help cover a scheme fee
	 * would be asking against a cost that does not exist.
	 */
	provider?: string | null;
	/** Whether the buyer has opted into the voluntary gateway contribution. */
	processingContribution?: boolean;
	/** Client-sniffed payment capabilities. */
	capabilities?: BasketCapabilities;
}
// #endregion

// #region Parsing
/** Coerce a query flag (`1` · `true` · `yes` · `on`) to a boolean, or `undefined` when absent. */
function flag(raw: string | null): boolean | undefined {
	if (raw === null) return undefined;
	const v = raw.trim().toLowerCase();
	if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
	if (v === "0" || v === "false" || v === "no" || v === "off") return false;
	return undefined;
}

/** Parse the capability flags from a query string. */
export function parseCapabilities(sp: URLSearchParams): BasketCapabilities | undefined {
	const caps: BasketCapabilities = {};
	const gpay = flag(sp.get("googlePay"));
	if (gpay !== undefined) caps.googlePay = gpay;
	const apay = flag(sp.get("applePay"));
	if (apay !== undefined) caps.applePay = apay;
	const paypal = flag(sp.get("paypal"));
	if (paypal !== undefined) caps.paypalEnabled = paypal;
	return Object.keys(caps).length > 0 ? caps : undefined;
}

/**
 * The `owner` param a context defaults to: `personal` for an individual, `{entity}:{id}` for a
 * team/business/organisation context. Mirrors the wallet's `defaultWalletParam`, so switching context
 * moves the wallet and the basket together.
 */
export function defaultOwnerParam(context: UserContext): string {
	switch (context.contextType) {
		case "team":
			return context.contextId ? `team:${context.contextId}` : "personal";
		case "business":
			return context.contextId ? `business:${context.contextId}` : "personal";
		case "organisation":
			return context.contextId ? `organisation:${context.contextId}` : "personal";
		default:
			return "personal";
	}
}

/**
 * Build the fat-service {@link BasketQuery} from a request's URL + the acting context (server-side).
 *
 * The deep-link narrowing accepts the documented snake_case params (`?project_id=` / `?service_id=`,
 * per the SSOT's `CheckoutPreselect`) and their camelCase spellings, because a link is written by hand
 * as often as it is generated.
 */
export function basketQueryFrom(sp: URLSearchParams, context: UserContext): BasketQuery {
	return {
		basketId: sp.get("basketId") ?? sp.get("basket"),
		owner: sp.get("owner") ?? defaultOwnerParam(context),
		display: sp.get("display"),
		projectId: sp.get("project_id") ?? sp.get("projectId"),
		serviceId: sp.get("service_id") ?? sp.get("serviceId"),
		viewerCurrency: context.displayCurrency ?? null,
		provider: sp.get("provider"),
		processingContribution: flag(sp.get("contribute")) ?? false,
		capabilities: parseCapabilities(sp),
	};
}

/**
 * Build a {@link BasketQuery} from a mutation's JSON body — the same fields, read from the POST payload
 * so the basket returned alongside a write is read the way the page that sent it reads.
 */
export function basketQueryFromBody(
	body: Record<string, unknown>,
	context: UserContext,
): BasketQuery {
	const sp = new URLSearchParams();
	for (
		const key of [
			"basketId",
			"owner",
			"display",
			"googlePay",
			"applePay",
			"paypal",
			"provider",
			"contribute",
		]
	) {
		const value = body[key];
		if (typeof value === "string") sp.set(key, value);
		else if (typeof value === "boolean") sp.set(key, value ? "1" : "0");
	}
	return basketQueryFrom(sp, context);
}
// #endregion
