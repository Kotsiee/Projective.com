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
 * What IS declared here is feature-local and has no server counterpart: the device capabilities a
 * request reports, the SSR bootstraps, and the small vocabulary the lane and bands navigate by.
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
	CheckoutSettlement,
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
// #endregion

// #region Device capabilities
/**
 * What this device and deployment can pay with — capability reports, never a simulation of the buyer.
 *
 * They travel as query params so the server's provider offer can consult them. While no payment
 * processor is connected the server refuses every processor-backed route regardless, so these decide
 * nothing today; they are sent because they are true, and because the day a processor is connected
 * the offer must not have to be re-plumbed to learn them.
 */
export interface DeviceCapabilities {
	/**
	 * Whether this browser offers Google Pay. Left ABSENT: availability can only be determined with
	 * Google's own `pay.js`, which this platform does not load, and an unknown capability is not
	 * reported as either answer.
	 */
	googlePay?: boolean;
	/** Whether this device offers Apple Pay (`ApplePaySession.canMakePayments()`). */
	applePay?: boolean;
	/** Whether PayPal is configured for this deployment. */
	paypalEnabled?: boolean;
}
// #endregion

// #region Read context
/**
 * The shared read context every `BasketService` / `CheckoutService` / `CardsService` call threads: which
 * basket, whose money, in which currency, narrowed to which deep link, from which device.
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
	/** What this device can pay with — see {@link DeviceCapabilities}. */
	device?: DeviceCapabilities;
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
