import type { UserContext } from "@projective/types/auth";
import type { CheckoutQuery } from "@projective/types/finance";

/**
 * basket-query — the resolved read shape for every `/api/basket/*`, `/api/checkout/*` and `/api/cards/*`
 * route, plus the parser that builds it from a request.
 *
 * **Why the parser is server-side rather than in a feature `core/`.** The `/wallet` precedent keeps its
 * parser app-side because the island also *writes* the query string (`buildSimQuery`). Nothing here is
 * written by an island: the basket read shape belongs to the service that consumes it, so it lives
 * beside {@link BasketBackendService} and the thin routes import it through the `@server/services/*`
 * alias. A client that wants to drive the simulation simply appends the documented params.
 *
 * **Dev simulation travels as query params, not as the seam.** The Dev Context Switcher publishes its
 * overrides as `data-dev-*` attributes on `<html>` — a CLIENT seam the server cannot see (root
 * CLAUDE.md §5). So every simulated axis this surface branches on is passed as a validated query param
 * the island refetches with, exactly as `/wallet` does.
 *
 * **Two naming vocabularies, deliberately.** The four ORIGINAL knobs (`persona`, `workspaceRole`,
 * `kyb`, `acting`) mirror axes the switcher already shipped and are named plainly, as `/wallet` names
 * its own; they are already documented in every `/api/basket/*` route's JSDoc, so renaming them would
 * break a published contract for cosmetic tidiness. The four axes ADDED for the `/basket` + `/checkout`
 * surfaces carry the `sim*` prefix of the newer `WorkspaceSim` precedent, which keeps them clear of the
 * generic query namespace. The mixed vocabulary is **flagged, not silently resolved** — unifying it is
 * a one-line rename plus a doc pass, and belongs to whoever next opens this contract.
 */

// #region Simulation axes
/** The persona / account type — mirrors the switcher's `DevPersona` (`data-dev-persona`). */
export type BasketPersona = "client" | "freelancer" | "team" | "business";
/** The role held inside the acting entity — mirrors `DevWorkspaceRole`. `non_member` refuses entity spend. */
export type BasketWorkspaceRole = "owner" | "admin" | "lead" | "member" | "non_member";
/** The acting entity's verification state — mirrors `DevWorkspaceVerification` (drives the KYB gate). */
export type BasketKyb = "unverified" | "kyb_pending" | "verified";
/**
 * Which principal's basket is being spent from.
 *
 * A NEW axis rather than a reuse: `actingContext` is a boolean (personal ⇄ the acting entity) and
 * `workspaceKind` is `team | business` only, so between them there is no way to reach an
 * **organisation** basket at runtime — which is precisely the scope whose wallet is absent from the
 * cast and whose provider offer therefore differs.
 */
export type BasketOwnerScope = "personal" | "team" | "business" | "organisation";
/**
 * A preset over the payment offer, expressed as INPUTS to the SSOT's `availableProviders` rather than
 * as an override of its verdict — the rules stay the single source of truth and the preset only moves
 * the context they are evaluated against.
 */
export type BasketProviderPreset = "all" | "no_wallet" | "card_only" | "invoice";
/** Whether the acting wallet covers the resolved total, or falls short of it. */
export type BasketWalletCoverage = "covers" | "shortfall";
/** The shape of the account's saved-card wallet (seeded · none on file · all expired). */
export type BasketCardState = "seeded" | "none" | "expired";

const PERSONAS: readonly BasketPersona[] = ["client", "freelancer", "team", "business"];
const WORKSPACE_ROLES: readonly BasketWorkspaceRole[] = [
	"owner",
	"admin",
	"lead",
	"member",
	"non_member",
];
const KYB_STATES: readonly BasketKyb[] = ["unverified", "kyb_pending", "verified"];
const OWNER_SCOPES: readonly BasketOwnerScope[] = [
	"personal",
	"team",
	"business",
	"organisation",
];
const PROVIDER_PRESETS: readonly BasketProviderPreset[] = [
	"all",
	"no_wallet",
	"card_only",
	"invoice",
];
const WALLET_COVERAGES: readonly BasketWalletCoverage[] = ["covers", "shortfall"];
const CARD_STATES: readonly BasketCardState[] = ["seeded", "none", "expired"];

/**
 * Whether the buyer already has complete saved delivery + billing details.
 *
 * The axis that makes the Details step's AUTO-SKIP reachable at runtime. Without it a developer can
 * only see one of the two branches, and the one they cannot see is the one that silently sends a
 * buyer past a form — which is exactly the branch worth being able to look at.
 */
export type BasketDetailsState = "saved" | "missing";
/** Which billing identity the Details form opens on — a natural person or a company. */
export type BasketBillingContext = "personal" | "business";
/** The acting entity's invoicing mode (`org.business_profiles.invoicing_mode`). */
export type BasketInvoicingMode = "per_transaction" | "intervaled_monthly";
/**
 * Whether this purchase exceeds the acting member's spending limit.
 *
 * `finance.spending_limits` is the real authority; this axis reaches the OVER state without having to
 * construct a basket that happens to cross a seeded cap.
 */
export type BasketSpendLimit = "within" | "over";
/** Which fulfilment routes the confirmation hub has to render. */
export type BasketFulfilmentMix = "mixed" | "products" | "tickets" | "sessions" | "pending";
/**
 * Which conferencing provider a booked session's join link resolves to.
 *
 * Separate from the calendar exports on purpose: conferencing (the room) and calendar sync (Google ·
 * Outlook · `.ics`) are two capability axes on `integrations.providers`, never one chip set
 * (CLAUDE.md Decision #56). Google appears in both only because it genuinely does both. `none` is a
 * real state — a room is minted by the provider, and until one exists there is nothing to join.
 */
export type BasketConferencing = "zoom" | "google" | "microsoft_teams" | "none";

const DETAILS_STATES: readonly BasketDetailsState[] = ["saved", "missing"];
const BILLING_CONTEXTS: readonly BasketBillingContext[] = ["personal", "business"];
const INVOICING_MODES: readonly BasketInvoicingMode[] = ["per_transaction", "intervaled_monthly"];
const SPEND_LIMITS: readonly BasketSpendLimit[] = ["within", "over"];
const FULFILMENT_MIXES: readonly BasketFulfilmentMix[] = [
	"mixed",
	"products",
	"tickets",
	"sessions",
	"pending",
];
const CONFERENCING: readonly BasketConferencing[] = [
	"zoom",
	"google",
	"microsoft_teams",
	"none",
];

/**
 * The fixture-shaping simulation knobs (dev-only; ignored on the live path).
 *
 * Device-wallet and PayPal availability are **not** dev axes — they are genuine capability the client
 * sniffs and hands to the server, which is precisely what the SSOT's `ProviderContext.deviceWallets` /
 * `paypalEnabled` document. They ride the same query string because they have the same shape.
 */
export interface BasketSim {
	/** Simulated persona — decides whether the personal basket spends as `user` or as `freelancer`. */
	persona?: BasketPersona;
	/** Simulated entity role — `non_member` is what reaches the individual-on-business refusal. */
	workspaceRole?: BasketWorkspaceRole;
	/** Simulated entity verification — anything but `verified` blocks an entity checkout. */
	kyb?: BasketKyb;
	/** Whether the session is simulated as ACTING as the entity rather than personally. */
	actingContext?: boolean;
	/** Simulated basket scope — which principal's money this read spends (`simOwnerScope`). */
	ownerScope?: BasketOwnerScope;
	/** Simulated payment-offer preset, applied as inputs to the SSOT rules (`simProviders`). */
	providers?: BasketProviderPreset;
	/** Simulated wallet position against the resolved total (`simWalletCover`). */
	walletCover?: BasketWalletCoverage;
	/** Simulated saved-card wallet shape (`simCards`). */
	cards?: BasketCardState;
	/** Whether this browser offers Google Pay (client-sniffed capability, not a simulation). */
	googlePay?: boolean;
	/** Whether this device offers Apple Pay (client-sniffed capability, not a simulation). */
	applePay?: boolean;
	/** Whether PayPal is configured for this deployment (deployment config, not a simulation). */
	paypalEnabled?: boolean;
	/** Simulated saved-details state — drives the Details step's auto-skip (`simDetails`). */
	details?: BasketDetailsState;
	/** Simulated billing identity the Details form opens on (`simBilling`). */
	billing?: BasketBillingContext;
	/** Simulated entity invoicing mode (`simInvoicing`). */
	invoicing?: BasketInvoicingMode;
	/** Simulated position against the member spending limit (`simSpendLimit`). */
	spendLimit?: BasketSpendLimit;
	/** Simulated fulfilment mix on the confirmation hub (`simFulfilment`). */
	fulfilment?: BasketFulfilmentMix;
	/** Simulated conferencing provider for a booked session (`simConferencing`). */
	conferencing?: BasketConferencing;
}
// #endregion

// #region Resolved query
/**
 * A resolved basket/checkout read: which basket, whose money, in which currency, narrowed to which
 * deep link, for whom, under which simulation.
 *
 * Extends the SSOT's {@link CheckoutQuery} with the viewer identity the fixtures scope on. Every added
 * member is optional, so a bare `CheckoutQuery` is still assignable — the service methods keep the
 * contract's published signature.
 */
export interface BasketQuery extends CheckoutQuery {
	/** The acting user's `@handle` (the personal basket owner). */
	viewerHandle?: string | null;
	/** The acting user's id. */
	viewerId?: string | null;
	/** Whether the acting user offers services — decides the personal basket's `PurchaseOwnerType`. */
	isFreelancer?: boolean;
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
	sim?: BasketSim;
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

/** Narrow a raw param to a member of `allowed`, else `undefined`. */
function oneOf<T extends string>(raw: string | null, allowed: readonly T[]): T | undefined {
	return raw !== null && (allowed as readonly string[]).includes(raw) ? raw as T : undefined;
}

/**
 * Parse the simulation + client-capability knobs from a query string. Returns `undefined` when nothing
 * was supplied, so an un-simulated request is byte-identical to one that never knew about the seam.
 */
export function parseBasketSim(sp: URLSearchParams): BasketSim | undefined {
	const sim: BasketSim = {};
	const persona = oneOf(sp.get("persona"), PERSONAS);
	if (persona) sim.persona = persona;
	const role = oneOf(sp.get("workspaceRole"), WORKSPACE_ROLES);
	if (role) sim.workspaceRole = role;
	const kyb = oneOf(sp.get("kyb"), KYB_STATES);
	if (kyb) sim.kyb = kyb;
	const acting = flag(sp.get("acting"));
	if (acting !== undefined) sim.actingContext = acting;
	const ownerScope = oneOf(sp.get("simOwnerScope"), OWNER_SCOPES);
	if (ownerScope) sim.ownerScope = ownerScope;
	const providers = oneOf(sp.get("simProviders"), PROVIDER_PRESETS);
	if (providers) sim.providers = providers;
	const walletCover = oneOf(sp.get("simWalletCover"), WALLET_COVERAGES);
	if (walletCover) sim.walletCover = walletCover;
	const cards = oneOf(sp.get("simCards"), CARD_STATES);
	if (cards) sim.cards = cards;
	const gpay = flag(sp.get("googlePay"));
	if (gpay !== undefined) sim.googlePay = gpay;
	const apay = flag(sp.get("applePay"));
	if (apay !== undefined) sim.applePay = apay;
	const paypal = flag(sp.get("paypal"));
	if (paypal !== undefined) sim.paypalEnabled = paypal;
	const details = oneOf(sp.get("simDetails"), DETAILS_STATES);
	if (details) sim.details = details;
	const billing = oneOf(sp.get("simBilling"), BILLING_CONTEXTS);
	if (billing) sim.billing = billing;
	const invoicing = oneOf(sp.get("simInvoicing"), INVOICING_MODES);
	if (invoicing) sim.invoicing = invoicing;
	const spendLimit = oneOf(sp.get("simSpendLimit"), SPEND_LIMITS);
	if (spendLimit) sim.spendLimit = spendLimit;
	const fulfilment = oneOf(sp.get("simFulfilment"), FULFILMENT_MIXES);
	if (fulfilment) sim.fulfilment = fulfilment;
	const conferencing = oneOf(sp.get("simConferencing"), CONFERENCING);
	if (conferencing) sim.conferencing = conferencing;
	return Object.keys(sim).length > 0 ? sim : undefined;
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
		viewerHandle: context.handle,
		viewerId: context.userId,
		isFreelancer: context.isFreelancer,
		provider: sp.get("provider"),
		processingContribution: flag(sp.get("contribute")) ?? false,
		sim: parseBasketSim(sp),
	};
}

/**
 * Build a {@link BasketQuery} from a mutation's JSON body — the same knobs, read from the POST payload
 * so the basket returned alongside a write reflects the same simulated persona the read used. Mirrors
 * `/api/wallet/action`'s `simFromBody`.
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
			"persona",
			"workspaceRole",
			"kyb",
			"acting",
			"simOwnerScope",
			"simProviders",
			"simWalletCover",
			"simCards",
			"googlePay",
			"applePay",
			"paypal",
			"provider",
			"contribute",
			"simDetails",
			"simBilling",
			"simInvoicing",
			"simSpendLimit",
			"simFulfilment",
			"simConferencing",
		]
	) {
		const value = body[key];
		if (typeof value === "string") sp.set(key, value);
		else if (typeof value === "boolean") sp.set(key, value ? "1" : "0");
	}
	return basketQueryFrom(sp, context);
}
// #endregion
