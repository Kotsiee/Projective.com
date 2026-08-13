/**
 * checkout-types — the ONE import surface every `/basket` + `/checkout` module, island and component
 * reads its shapes from.
 *
 * Almost everything here is a straight re-export of the Zod SSOT (`@projective/types/finance`): the
 * basket, its lines and groups, the checkout session projection, saved cards and the card-art config.
 * Nothing is redefined — a second declaration of `BasketItem` app-side is how a surface comes to render
 * a field the server stopped sending. The re-export exists so a feature file imports one path instead
 * of four, exactly as `wallet/types/wallet-types.ts` does.
 *
 * What IS declared here is feature-local and has no server counterpart: the client's mirror of the
 * simulation axes, the SSR bootstraps, and the small vocabulary the lane and bands navigate by.
 */

// #region SSOT re-exports (never redeclared)
export type {
	AddBasketItem,
	AppliedPromo,
	ApplyPromoCode,
	Basket,
	BasketGroup,
	BasketItem,
	BasketSummary,
	CardArtConfig,
	CardBrand,
	CheckoutBlocker,
	CheckoutBlockerCode,
	CheckoutOwner,
	CheckoutPreselect,
	CheckoutResult,
	CheckoutResultStatus,
	CheckoutSessionContext,
	CheckoutTotals,
	CheckoutWallet,
	CreateCheckout,
	ItemKindMeta,
	MoneyView,
	MoveBasketItem,
	PaymentProvider,
	ProviderAvailability,
	PurchasableItemGroup,
	PurchasableItemKind,
	PurchaseOwnerType,
	RemoveBasketItem,
	SaveCardInput,
	SavedCard,
	UpdateBasketItem,
} from "@projective/types/finance";
export type {
	BasketListEntry,
	BasketListKind,
	BasketLists,
	BillingContext,
	BillingContextKind,
	BuyerDetails,
	CalendarLinks,
	CreateBasketList,
	DeliveryDetails,
	FulfilmentKind,
	InvoicingMode,
	MonthlyInvoicing,
	Order,
	OrderInvoice,
	OrderLine,
	OrderPage,
	OrderStatus,
	PersonalBilling,
	PostalAddress,
	ProcessingContributionOffer,
	SaveBuyerDetails,
	SpendLimitBlock,
	TaxBreakdown,
} from "@projective/types/finance";
export type { BusinessBilling } from "@projective/types/finance";

// Re-exporting a type does not bind it in THIS module's scope, and the two below are referenced by
// the `BasketSim` mirror further down — so they are imported as well as re-exported.
import type { BillingContextKind, InvoicingMode } from "@projective/types/finance";
// #endregion

// #region Simulation axes (the CLIENT mirror of `@server/services/finance/basket-query.ts`)
/**
 * The client's mirror of the fat service's `BasketSim`.
 *
 * It is restated rather than imported because `packages/backend` is a SERVER workspace member and an
 * island may not reach into it (root CLAUDE.md §2) — the two sides share the query-string CONTRACT,
 * never a module, exactly as the dev seam's read and write sides do. Every member is optional, so an
 * un-simulated request is byte-identical to one from before this seam existed.
 */
export interface BasketSim {
	/** Mirrors `DevPersona` — decides whether a personal basket spends as `user` or `freelancer`. */
	persona?: "client" | "freelancer" | "team" | "business";
	/** Mirrors `DevWorkspaceRole` — `non_member` is what reaches the individual-on-entity refusal. */
	workspaceRole?: "owner" | "admin" | "lead" | "member" | "non_member";
	/** Mirrors `DevWorkspaceVerification` — anything but `verified` blocks an entity checkout. */
	kyb?: "unverified" | "kyb_pending" | "verified";
	/** Whether the session is acting AS the entity rather than personally. */
	actingContext?: boolean;
	/** Which principal's basket is being spent from (`simOwnerScope`). */
	ownerScope?: BasketOwnerScope;
	/** The payment-offer preset (`simProviders`). */
	providers?: PaymentOfferPreset;
	/** The wallet's position against the resolved total (`simWalletCover`). */
	walletCover?: WalletCoverage;
	/** The saved-card wallet's shape (`simCards`). */
	cards?: SavedCardState;
	/** Whether this browser offers Google Pay — a real capability sniff, not a simulation. */
	googlePay?: boolean;
	/** Whether this device offers Apple Pay — a real capability sniff, not a simulation. */
	applePay?: boolean;
	/** Whether PayPal is configured for this deployment — deployment config, not a simulation. */
	paypalEnabled?: boolean;
	/** Whether the buyer's saved details are complete (`simDetails`) — drives the Details auto-skip. */
	details?: BuyerDetailsState;
	/** Which billing identity the Details form opens on (`simBilling`). */
	billing?: BillingContextKind;
	/** The acting entity's invoicing mode (`simInvoicing`). */
	invoicing?: InvoicingMode;
	/** Whether this purchase clears the acting member's spending limit (`simSpendLimit`). */
	spendLimit?: SpendLimitState;
	/** Which fulfilment routes the confirmation hub renders (`simFulfilment`). */
	fulfilment?: FulfilmentMix;
	/** Which conferencing provider a booked session resolves to (`simConferencing`). */
	conferencing?: ConferencingChoice;
}

/** Whether the buyer already has complete saved delivery + billing details. */
export type BuyerDetailsState = "saved" | "missing";
/** Whether this purchase clears the acting member's spending limit. */
export type SpendLimitState = "within" | "over";
/** Which fulfilment routes the confirmation hub has to render. */
export type FulfilmentMix = "mixed" | "products" | "tickets" | "sessions" | "pending";
/** Which conferencing provider a booked session's join link resolves to. */
export type ConferencingChoice = "zoom" | "google" | "microsoft_teams" | "none";

/** Which principal's money a basket spends. */
export type BasketOwnerScope = "personal" | "team" | "business" | "organisation";
/** A preset over the checkout's payment offer, applied as INPUTS to the SSOT eligibility rules. */
export type PaymentOfferPreset = "all" | "no_wallet" | "card_only" | "invoice";
/** Whether the acting wallet covers the resolved total, or falls short of it. */
export type WalletCoverage = "covers" | "shortfall";
/** The shape of the account's saved-card wallet. */
export type SavedCardState = "seeded" | "none" | "expired";
// #endregion

// #region Read context
/**
 * The shared read context every `BasketService` / `CheckoutService` / `CardsService` call threads: which
 * basket, whose money, in which currency, narrowed to which deep link, under which simulation.
 *
 * Mirrors `WalletContext`. It is the client half of the query string the fat service's `basketQueryFrom`
 * parses, so the two are one contract read from both ends.
 */
export interface CheckoutContext {
	/** The basket to read; `null` resolves the acting account's default. */
	basketId: string | null;
	/** `personal` or `{entity}:{id}`; `null` resolves the active context. */
	owner: string | null;
	/** The viewer's display currency; `null` defers to the basket's own. */
	display: string | null;
	/** `?project_id=` narrowing — a checkout scoped to one project's lines. */
	projectId?: string | null;
	/** `?service_id=` narrowing — a checkout scoped to one service's lines. */
	serviceId?: string | null;
	/** The live dev-simulation knobs; `undefined` in production and whenever no override is active. */
	sim?: BasketSim;
	/**
	 * The payment route the buyer has selected, when they have. Read server-side only to decide
	 * whether the gateway-contribution offer applies — a wallet or invoice payment touches no card
	 * scheme, so there is no third-party cost to offer to help cover.
	 */
	provider?: string | null;
	/** Whether the buyer has opted into the voluntary gateway contribution. */
	contribute?: boolean;
}
// #endregion

// #region Surface vocabulary
/**
 * The coarse two-route split the lane and the bands were originally written against.
 *
 * KEPT, not retired: the lane's dual presentation and the footer rig both branch on it, and the
 * finer {@link CheckoutStep} is a refinement of it rather than a replacement — `basket` is step 1,
 * `checkout` is steps 2–4. Both are resolved from the pathname by `basket-model.ts`, so they cannot
 * disagree.
 */
export type CheckoutView = "basket" | "checkout";

/**
 * One step of the four-step flow. Re-exported from the pure model so a component imports its types
 * from one place, exactly as every other shape on this surface does.
 */
export type { CheckoutStep } from "../core/basket-model.ts";

/** A `/basket` lane destination — a named basket, or the parked shelf. */
export interface BasketLaneEntry {
	/** The basket id, or `saved` for the saved-for-later shelf. */
	key: string;
	label: string;
	/** Line count shown beside the label; `null` for a section that does not count. */
	count: number | null;
	href: string;
	active: boolean;
	/** Whether this is the account's default basket. */
	isDefault: boolean;
}
// #endregion

// #region SSR bootstraps
/** Everything the `/basket` route + its lane need without a client round trip. */
export interface BasketBootstrap {
	basket: import("@projective/types/finance").Basket;
	baskets: import("@projective/types/finance").BasketSummary[];
	promo: import("@projective/types/finance").AppliedPromo | null;
	/** The `?owner=` scope this read resolved against, echoed so the island refetches the same one. */
	owner: string;
	/** The display currency the server formatted every figure in. */
	display: string;
}

/** Everything the `/checkout` route + its bands need without a client round trip. */
export interface CheckoutBootstrap {
	session: import("@projective/types/finance").CheckoutSessionContext;
	/** The account's baskets, so the lane can paint its switcher on a checkout route too. */
	baskets: import("@projective/types/finance").BasketSummary[];
	owner: string;
	display: string;
}
// #endregion
