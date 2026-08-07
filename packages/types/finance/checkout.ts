import { z } from "zod";
import { basisPoints, currency, minorUnitsNonNeg, timestamp } from "./common.ts";
import { KycStatus } from "./verification.ts";
import { formatMoney, MoneyViewSchema } from "./wallet.ts";
import { CardBrand } from "./card-art.ts";
import {
	AppliedPromoSchema,
	BasketGroupSchema,
	BasketItem,
	BasketItemSchema,
	itemKindMeta,
	PurchaseOwnerType,
	reference,
} from "./basket.ts";

/**
 * finance checkout — the Zod SSOT for the payment surface: saved cards, the payment-provider offer,
 * the whole server projection the checkout page renders, and the **one arithmetic path** every total
 * on the platform is computed through.
 *
 * **Why the calculators live here and not in a service.** `basketSubtotal`/`applyDiscounts`/
 * `platformFeeFor`/`checkoutTotals` are pure, integer-only, and exported from the SSOT so the fat
 * service, the API route's re-validation, and any client-side preview all call the *same* function.
 * A second implementation is how two surfaces come to round a fee differently and only one of them is
 * what the buyer is charged. This mirrors `ticketCostLines`/`reconcileCard` in
 * `@projective/types/projects/board` (CLAUDE.md Decisions #64/#66).
 *
 * They return **integer minor units**, never a {@link MoneyViewSchema}: a `MoneyView` carries a
 * server-formatted display string, and minting one client-side would let a client-formatted figure
 * reach a surface that is supposed to render only what the server said. The service wraps these
 * integers into `MoneyView`s; a client preview formats them with {@link formatMoney}.
 *
 * Only enum/array/object/number/string/boolean primitives are used so the schemas stay stable across
 * Zod majors (matching `common.ts`).
 */

// #region Platform fee
/**
 * The canonical platform service fee in basis points — **500 bp = 5% flat** (CLAUDE.md §8 Decision #2;
 * `finance-model.md` §1.1 is canonical, and `investor-summary.md`'s 10% was corrected against it).
 * Stripe processing costs are passed through separately and are never folded into this number.
 *
 * The live authority is `security.platform_params.platform_fee_bp`, resolved through
 * `finance.fn_effective_platform_fee_bp` (which lets a negotiated Organisation rate override it). This
 * constant is the default every caller falls back to when no resolved rate is in hand, so the value
 * exists in the SSOT once instead of being retyped at each call site.
 */
export const PLATFORM_FEE_BP = 500;

/**
 * Who bears the platform fee on a given checkout.
 *
 * `seller_deducted` — the fee is taken out of the release to the seller, so the buyer's total is the
 * goods price and the fee line is shown as *disclosure*, not as an addition. This is the platform's
 * documented behaviour (`finance-model.md`: the fee is applied on escrow release).
 *
 * `buyer_added` — the fee is added on top of the goods price and the buyer pays it.
 *
 * Both are modelled because the two source documents disagree on which the checkout shows, and a
 * boolean baked into the arithmetic would silently pick one. {@link checkoutTotals} defaults to
 * `seller_deducted`, the documented rule.
 */
export const PlatformFeeMode = z.enum(["seller_deducted", "buyer_added"]);
export type PlatformFeeMode = z.infer<typeof PlatformFeeMode>;
// #endregion

// #region Saved cards
/**
 * A card on file.
 *
 * ⚠️ **There is no PAN field and no CVV field, not even optional.** Card data is Stripe-owned
 * (`finance/methods.ts`, `finance-model.md` §Payment Methods): we hold an opaque
 * `stripePaymentMethodId` plus the display fragments Stripe itself returns. `binNumber` is the leading
 * issuer-identification digits only — it identifies a card *programme*, never an account — and exists
 * solely so {@link resolveCardArt} can derive a face without a network request. A schema that cannot
 * express a card number cannot leak one.
 */
export const SavedCardSchema = z.object({
	id: reference,
	ownerType: PurchaseOwnerType,
	ownerId: reference,
	/** The `finance.payment_methods` row this card is registered as, once promoted; else `null`. */
	paymentMethodId: reference.nullable(),
	/** The opaque Stripe PaymentMethod reference. Placeholder `XXXX-XXXX` in docs and examples. */
	stripePaymentMethodId: z.string().min(1).max(200),
	/** `finance.card_brand` — the display fragment Stripe returns. `unknown` is the column default. */
	brand: CardBrand,
	/**
	 * The final four digits — the only part of the number we ever hold. Nullable to mirror the column:
	 * a wallet-wrapped or vault instrument may carry none.
	 */
	last4: z.string().max(4).nullable(),
	expMonth: z.number().int().min(1).max(12).nullable(),
	expYear: z.number().int().min(2000).max(2100).nullable(),
	cardholderName: z.string().max(120).nullable(),
	/**
	 * The 6–8 digit issuer identification number. **Usually `null`** — Stripe returns an IIN only under
	 * an explicitly granted entitlement — so every consumer must degrade to {@link brand} alone, which
	 * is exactly what {@link resolveCardArt} does.
	 */
	binNumber: z.string().regex(/^[0-9]{6,8}$/, "Expected 6–8 issuer-identification digits.")
		.nullable(),
	/** Whether this card spends an entity's money — the gate in {@link availableProviders}. */
	isBusinessCard: z.boolean(),
	isDefault: z.boolean(),
	/**
	 * The user who added the card (an entity card is added by a member and audited to them). Nullable:
	 * the column is `ON DELETE SET NULL`, so a departed member does not erase the entity's saved card.
	 */
	createdByUserId: reference.nullable(),
	createdAt: timestamp,
	/** Derived server-side against the server clock — a client clock must not decide a card is dead. */
	isExpired: z.boolean(),
});
export type SavedCard = z.infer<typeof SavedCardSchema>;

/**
 * Register a card. The payload carries a **tokenised reference only** — the number is collected by
 * Stripe Elements in an iframe we do not script, so it never enters this application's memory, let
 * alone this schema. `brand`/`last4`/expiry are read back from Stripe on the server, which is why they
 * are absent here: accepting them from the client would let a caller mislabel a card.
 */
export const SaveCardInputSchema = z.object({
	ownerType: PurchaseOwnerType,
	ownerId: reference,
	/** The opaque token Stripe Elements hands back. */
	stripePaymentMethodId: z.string().min(1).max(200),
	cardholderName: z.string().max(120).nullable(),
	/** Marks the card as spending an entity's money; refused server-side for a non-member. */
	isBusinessCard: z.boolean(),
	/** Make this the owner's default card after it is attached. */
	setDefault: z.boolean(),
	label: z.string().max(120).nullable(),
});
export type SaveCardInput = z.infer<typeof SaveCardInputSchema>;
// #endregion

// #region Payment providers
/** The ways a checkout can be paid. */
export const PaymentProvider = z.enum([
	"card",
	"wallet",
	"google_pay",
	"apple_pay",
	"paypal",
	"invoice",
]);
export type PaymentProvider = z.infer<typeof PaymentProvider>;

/**
 * One provider's offer.
 *
 * A refused provider is **rendered and disabled with its reason**, never omitted. A payment method
 * that is silently absent is unexplainable: the buyer cannot tell whether they are ineligible, whether
 * the platform is broken, or whether they simply cannot see it — which is the same gate/absence
 * distinction the `/wallet` surface draws (CLAUDE.md Decision #60).
 */
export const ProviderAvailabilitySchema = z.object({
	provider: PaymentProvider,
	available: z.boolean(),
	/** A display-ready sentence explaining the refusal; `null` when {@link available}. */
	reason: z.string().max(200).nullable(),
});
export type ProviderAvailability = z.infer<typeof ProviderAvailabilitySchema>;

/** What {@link availableProviders} needs to decide the offer. */
export interface ProviderContext {
	/** Whose money is being spent. */
	ownerType: PurchaseOwnerType;
	/** Whether the acting user is an authorised member of that owner (always true for their own money). */
	actingIsMember: boolean;
	/** The wallet's Available balance in {@link currency}, integer minor units. */
	walletAvailableMinor: number;
	/** What the checkout will charge, integer minor units. */
	totalMinor: number;
	/** The checkout currency, used to phrase a shortfall. */
	currency: string;
	savedCards: readonly SavedCard[];
	/** KYB status of the spending entity; `null` for an individual. */
	kybStatus: KycStatus | null;
	/** The entity's verification tier — Level 3 is Business/KYB (`PRODUCT_SPEC` §Identity). */
	verificationTier: number | null;
	/** Device wallet capability, sniffed by the client and passed to the server. */
	deviceWallets?: { googlePay?: boolean; applePay?: boolean };
	/** Whether PayPal is configured for this deployment. */
	paypalEnabled?: boolean;
}

/** Owner types whose money belongs to an entity rather than to the acting individual. */
function isEntityOwner(ownerType: PurchaseOwnerType): boolean {
	return ownerType === "business" || ownerType === "team" || ownerType === "organisation";
}

const KYB_TIER = 3;

/**
 * Resolve which payment providers this buyer may use, and why not for each one they may not.
 *
 * The three rules, in the order they bind:
 *
 *  1. **An individual may not purchase on an entity's behalf.** If the basket spends entity money and
 *     the acting user is not a member of that entity, every provider is refused — there is no path
 *     that lets a non-member charge a business, including their own card.
 *  2. **An entity may only spend from its Projective wallet or a verified business card.** Personal
 *     device wallets and PayPal are individual instruments; offering them in an entity context would
 *     invite a member to front an entity purchase personally, which breaks attribution and refunds.
 *  3. **Invoicing requires KYB Level 3.** Deferred settlement is credit, and credit is extended to a
 *     verified business, never to an individual.
 *
 * Pure and total — the same inputs always yield the same offer, so the server's decision and the
 * client's rendering of it cannot diverge. Returns every provider in the enum's declared order, which
 * is also the display order.
 */
export function availableProviders(ctx: ProviderContext): ProviderAvailability[] {
	const entity = isEntityOwner(ctx.ownerType);
	const money = (minor: number) => formatMoney(minor, ctx.currency);

	if (entity && !ctx.actingIsMember) {
		const reason =
			"Only a member of this account can pay from it. Switch to your personal account to buy this yourself.";
		return PaymentProvider.options.map((provider) => ({ provider, available: false, reason }));
	}

	const covers = ctx.walletAvailableMinor >= ctx.totalMinor;
	const shortfall = Math.max(ctx.totalMinor - ctx.walletAvailableMinor, 0);
	const businessCards = ctx.savedCards.filter((c) => c.isBusinessCard && !c.isExpired);
	const kybVerified = ctx.kybStatus === "verified" && (ctx.verificationTier ?? 0) >= KYB_TIER;

	const entityOnlyReason =
		"A business purchase must be paid from the business wallet or a business card.";

	const offer: ProviderAvailability[] = [];

	for (const provider of PaymentProvider.options) {
		switch (provider) {
			case "card": {
				if (entity) {
					offer.push(
						businessCards.length > 0 ? { provider, available: true, reason: null } : {
							provider,
							available: false,
							reason:
								"Add a business card to this account to pay by card. Personal cards cannot be used here.",
						},
					);
				} else {
					offer.push({ provider, available: true, reason: null });
				}
				break;
			}
			case "wallet": {
				offer.push(
					covers ? { provider, available: true, reason: null } : {
						provider,
						available: false,
						reason: `Not enough available balance — ${
							money(shortfall)
						} short. Top up to pay from the wallet.`,
					},
				);
				break;
			}
			case "google_pay": {
				if (entity) {
					offer.push({ provider, available: false, reason: entityOnlyReason });
				} else {
					offer.push(
						ctx.deviceWallets?.googlePay ? { provider, available: true, reason: null } : {
							provider,
							available: false,
							reason: "Google Pay is not set up in this browser.",
						},
					);
				}
				break;
			}
			case "apple_pay": {
				if (entity) {
					offer.push({ provider, available: false, reason: entityOnlyReason });
				} else {
					offer.push(
						ctx.deviceWallets?.applePay ? { provider, available: true, reason: null } : {
							provider,
							available: false,
							reason: "Apple Pay is not available on this device.",
						},
					);
				}
				break;
			}
			case "paypal": {
				if (entity) {
					offer.push({ provider, available: false, reason: entityOnlyReason });
				} else {
					offer.push(
						ctx.paypalEnabled === false
							? { provider, available: false, reason: "PayPal is not available right now." }
							: { provider, available: true, reason: null },
					);
				}
				break;
			}
			case "invoice": {
				if (!entity) {
					offer.push({
						provider,
						available: false,
						reason: "Invoicing is available to verified business accounts.",
					});
				} else if (!kybVerified) {
					offer.push({
						provider,
						available: false,
						reason: "Complete business verification (KYB) to pay by invoice.",
					});
				} else {
					offer.push({ provider, available: true, reason: null });
				}
				break;
			}
		}
	}

	return offer;
}
// #endregion

// #region The arithmetic path
/**
 * Whether a line counts toward a checkout: selected, not parked, and still purchasable. Exported so
 * the totals, the row's enabled state and the "N items" caption all ask the same question.
 */
export function isCheckoutEligible(item: BasketItem): boolean {
	return item.isSelectedForCheckout && !item.savedForLater && item.available;
}

/**
 * The **gross** subtotal of the eligible lines: `Σ unitPrice × quantity`, in integer minor units.
 *
 * Deliberately *not* `Σ lineTotal` — a line total is already net of its creator discount, so summing
 * it would present a discounted figure as the pre-discount subtotal and make the discount line
 * disappear from the buyer's arithmetic. The relationship holds either way:
 * `Σ lineTotal === basketSubtotal − creatorDiscountMinor`.
 */
export function basketSubtotal(items: readonly BasketItem[]): number {
	let total = 0;
	for (const item of items) {
		if (!isCheckoutEligible(item)) continue;
		total += item.unitPrice.minor * item.quantity;
	}
	return total;
}

/** The discount split — creator discounts and a basket-wide promo, kept as separate lines. */
export interface DiscountBreakdown {
	/** Σ of the per-line creator discounts across the eligible lines. */
	creatorDiscountMinor: number;
	/** The basket-wide promo, clamped so it can never exceed what is left after creator discounts. */
	promoDiscountMinor: number;
	/** `subtotal − creatorDiscounts − promo`, floored at zero. */
	netMinor: number;
}

/**
 * Apply both discount layers to the gross subtotal.
 *
 * The promo is clamped to the remaining balance rather than allowed to go negative: a code worth more
 * than the basket reduces the basket to zero, it does not mint a credit. Both figures are reported so
 * the buyer sees two named savings instead of one unexplained delta.
 */
export function applyDiscounts(
	items: readonly BasketItem[],
	promoDiscountMinor = 0,
): DiscountBreakdown {
	const subtotal = basketSubtotal(items);
	let creator = 0;
	for (const item of items) {
		if (!isCheckoutEligible(item)) continue;
		creator += Math.max(item.discountAmount.minor, 0);
	}
	creator = Math.min(creator, subtotal);
	const promo = Math.min(Math.max(promoDiscountMinor, 0), subtotal - creator);
	return {
		creatorDiscountMinor: creator,
		promoDiscountMinor: promo,
		netMinor: subtotal - creator - promo,
	};
}

/**
 * The platform service fee on a discounted base, in integer minor units.
 *
 * Charged on what is actually transacted (post-discount), rounded half-up to the minor unit exactly
 * once. Pass a resolved rate from `finance.fn_effective_platform_fee_bp` when one is in hand;
 * otherwise the canonical {@link PLATFORM_FEE_BP} applies.
 */
export function platformFeeFor(baseMinor: number, feeBp: number = PLATFORM_FEE_BP): number {
	if (baseMinor <= 0 || feeBp <= 0) return 0;
	return Math.round((baseMinor * feeBp) / 10_000);
}

/** What {@link checkoutTotals} needs. Every amount is integer minor units. */
export interface CheckoutTotalsInput {
	items: readonly BasketItem[];
	/** The resolved promo saving, from {@link AppliedPromoSchema}; `0` when none applies. */
	promoDiscountMinor?: number;
	/**
	 * Tax determined by the tax engine for this buyer's jurisdiction. Passed in, never derived — this
	 * module has no jurisdiction, no nexus rules and no rate table, and inventing one would produce a
	 * number that looks authoritative and is wrong.
	 */
	taxMinor?: number;
	/** The effective fee rate; defaults to {@link PLATFORM_FEE_BP}. */
	platformFeeBp?: number;
	/** Who bears the fee; defaults to `seller_deducted`, the documented platform rule. */
	feeMode?: PlatformFeeMode;
}

/** The resolved totals in integer minor units — the service wraps these into `MoneyView`s. */
export interface CheckoutTotalsMinor {
	subtotalMinor: number;
	creatorDiscountMinor: number;
	promoDiscountMinor: number;
	/** `subtotal − creatorDiscounts − promo` — the goods price the buyer is actually paying for. */
	netMinor: number;
	platformFeeMinor: number;
	platformFeeBp: number;
	feeMode: PlatformFeeMode;
	taxMinor: number;
	/** `net + tax`, plus the fee only when {@link feeMode} is `buyer_added`. */
	totalMinor: number;
}

/**
 * The one place a checkout total is computed. Integer minor units end to end; no float ever enters the
 * chain, and rounding happens once, inside {@link platformFeeFor}.
 *
 * Order of operations: gross subtotal → creator discounts → promo → fee on the discounted base → tax →
 * total. The fee is added to the buyer's total **only** under `buyer_added`; under the default
 * `seller_deducted` it is reported for disclosure and the buyer pays `net + tax`.
 */
export function checkoutTotals(input: CheckoutTotalsInput): CheckoutTotalsMinor {
	const feeBp = input.platformFeeBp ?? PLATFORM_FEE_BP;
	const feeMode = input.feeMode ?? "seller_deducted";
	const taxMinor = Math.max(input.taxMinor ?? 0, 0);

	const subtotalMinor = basketSubtotal(input.items);
	const discounts = applyDiscounts(input.items, input.promoDiscountMinor ?? 0);
	const platformFeeMinor = platformFeeFor(discounts.netMinor, feeBp);

	return {
		subtotalMinor,
		creatorDiscountMinor: discounts.creatorDiscountMinor,
		promoDiscountMinor: discounts.promoDiscountMinor,
		netMinor: discounts.netMinor,
		platformFeeMinor,
		platformFeeBp: feeBp,
		feeMode,
		taxMinor,
		totalMinor: discounts.netMinor + taxMinor +
			(feeMode === "buyer_added" ? platformFeeMinor : 0),
	};
}
// #endregion

// #region Totals projection
/**
 * The totals block as the checkout renders it — every figure a server-computed {@link MoneyViewSchema}.
 * `platformFeeBp` and `platformFeeMode` travel with the money so the surface can label the fee line
 * honestly ("5% service fee, paid by the seller" vs "5% service fee") without inferring which it is.
 */
export const CheckoutTotalsSchema = z.object({
	subtotal: MoneyViewSchema,
	creatorDiscounts: MoneyViewSchema,
	promoDiscount: MoneyViewSchema,
	/** `subtotal − creatorDiscounts − promoDiscount`. */
	net: MoneyViewSchema,
	platformFee: MoneyViewSchema,
	platformFeeBp: basisPoints,
	platformFeeMode: PlatformFeeMode,
	taxes: MoneyViewSchema,
	/** How the tax was determined ("VAT 20% · United Kingdom"); `null` when no tax applies. */
	taxNote: z.string().max(160).nullable(),
	total: MoneyViewSchema,
});
export type CheckoutTotals = z.infer<typeof CheckoutTotalsSchema>;
// #endregion

// #region Checkout session projection
/** The account a checkout spends from, and whether the acting user may spend from it. */
export const CheckoutOwnerSchema = z.object({
	ownerType: PurchaseOwnerType,
	ownerId: reference,
	name: z.string().max(120),
	/** The entity `@handle` (canonical `/@handle` link); `null` for a personal account. */
	handle: z.string().max(40).nullable(),
	avatar: z.string().max(600).nullable(),
	/** Whether the acting user is an authorised member. Chrome only — RLS is the real gate. */
	actingIsMember: z.boolean(),
});
export type CheckoutOwner = z.infer<typeof CheckoutOwnerSchema>;

/**
 * The narrowing a deep-link requests (`?project_id=` / `?service_id=`), so a "pay for this project's
 * tickets" link checks out only those lines and leaves the rest of the basket intact.
 */
export const CheckoutPreselectSchema = z.object({
	projectId: reference.nullable(),
	serviceId: reference.nullable(),
});
export type CheckoutPreselect = z.infer<typeof CheckoutPreselectSchema>;

/** The wallet's standing against this checkout — balance, whether it covers, and by how much it falls short. */
export const CheckoutWalletSchema = z.object({
	available: MoneyViewSchema,
	/** The uncovered remainder; a zero-valued `MoneyView` when the balance covers the total. */
	shortfall: MoneyViewSchema,
	covers: z.boolean(),
});
export type CheckoutWallet = z.infer<typeof CheckoutWalletSchema>;

/** Why a checkout cannot proceed. Enumerated so every surface names the same obstacles. */
export const CheckoutBlockerCode = z.enum([
	"empty",
	"not_authorised",
	"unavailable_item",
	"missing_email",
	"missing_schedule",
	"missing_stage",
	"no_provider",
	"insufficient_funds",
	"verification_required",
	"price_changed",
]);
export type CheckoutBlockerCode = z.infer<typeof CheckoutBlockerCode>;

/** One reason Pay is refused, pointing at the line responsible when there is one. */
export const CheckoutBlockerSchema = z.object({
	code: CheckoutBlockerCode,
	/** A display-ready sentence naming what is missing and what fixes it. */
	message: z.string().max(200),
	/** The offending basket line; `null` when the blocker is basket-wide. */
	itemId: reference.nullable(),
});
export type CheckoutBlocker = z.infer<typeof CheckoutBlockerSchema>;

/**
 * The checkout page's entire server projection.
 *
 * Everything the surface renders is here and already resolved: which account is paying, which lines
 * are being paid for, what each provider costs the buyer in eligibility, what the wallet covers, and
 * the totals. The client selects and submits; it does not compute, group, or convert.
 */
export const CheckoutSessionContextSchema = z.object({
	basketId: reference,
	owner: CheckoutOwnerSchema,
	/** The display currency every figure in this projection is expressed in. */
	currency,
	/** The lines being paid for — the basket narrowed by {@link preselect} and by selection. */
	items: z.array(BasketItemSchema).max(200),
	/** Server-computed grouping over {@link items}, so the summary renders categories without grouping. */
	groups: z.array(BasketGroupSchema).max(40),
	preselect: CheckoutPreselectSchema,
	/** The provider the buyer has chosen; `null` until they pick one. */
	provider: PaymentProvider.nullable(),
	/** Every provider with its eligibility and reason — refused ones are shown, never omitted. */
	providers: z.array(ProviderAvailabilitySchema).max(12),
	wallet: CheckoutWalletSchema,
	savedCards: z.array(SavedCardSchema).max(24),
	/** The card pre-selected for a card payment; `null` when none is on file. */
	defaultCardId: reference.nullable(),
	promo: AppliedPromoSchema.nullable(),
	totals: CheckoutTotalsSchema,
	/** Whether any line needs a delivery address — drives the adaptive row layout. */
	requiresEmail: z.boolean(),
	/** Whether any line needs a booked slot. */
	requiresSchedule: z.boolean(),
	/** Whether any line needs a routed stage. */
	requiresStage: z.boolean(),
	/** Everything currently preventing payment; empty means Pay is live. */
	blockers: z.array(CheckoutBlockerSchema).max(20),
});
export type CheckoutSessionContext = z.infer<typeof CheckoutSessionContextSchema>;

/**
 * Which collection steps a set of lines demands, derived from {@link itemKindMeta}. Pure, so the
 * server projection and a client preview agree on whether the address field or the slot picker should
 * be on screen at all.
 */
export function checkoutRequirements(
	items: readonly BasketItem[],
): { requiresEmail: boolean; requiresSchedule: boolean; requiresStage: boolean } {
	let requiresEmail = false;
	let requiresSchedule = false;
	let requiresStage = false;
	for (const item of items) {
		if (!isCheckoutEligible(item)) continue;
		const meta = itemKindMeta(item.itemType);
		requiresEmail ||= meta.needsEmail;
		requiresSchedule ||= meta.needsSchedule;
		requiresStage ||= meta.needsStage;
	}
	return { requiresEmail, requiresSchedule, requiresStage };
}
// #endregion

// #region Checkout write payloads
/**
 * Start a checkout.
 *
 * `idempotencyKey` is mandatory and client-minted, held for the life of one payment attempt: a retried
 * submit, a double-click, or a reconnect after a dropped response must not charge twice. It is the
 * client's half of the `finance` idempotency ledger.
 */
export const CreateCheckoutSchema = z.object({
	basketId: reference,
	ownerType: PurchaseOwnerType,
	ownerId: reference,
	/** The lines being paid for — explicit, so a basket changed in another tab cannot widen the charge. */
	itemIds: z.array(reference).min(1).max(200),
	provider: PaymentProvider,
	/** The saved card to charge; required for `card`, `null` for every other provider. */
	cardId: reference.nullable(),
	promoCode: z.string().max(40).nullable(),
	currency,
	/**
	 * The total the buyer was shown, in minor units. The server recomputes with
	 * {@link checkoutTotals} and refuses on mismatch, so a price that moved between render and submit
	 * is caught rather than silently charged.
	 */
	expectedTotalMinor: minorUnitsNonNeg,
	idempotencyKey: z.string().min(8).max(120),
});
export type CreateCheckout = z.infer<typeof CreateCheckoutSchema>;

/** The outcome of a checkout attempt. */
export const CheckoutResultStatus = z.enum([
	"succeeded",
	"requires_action",
	"pending",
	"failed",
]);
export type CheckoutResultStatus = z.infer<typeof CheckoutResultStatus>;

/**
 * What a completed (or stalled) checkout returns. `requires_action` carries `nextActionUrl` for the
 * provider's own step (3-D Secure, a PayPal approval) rather than attempting it in-app.
 */
export const CheckoutResultSchema = z.object({
	status: CheckoutResultStatus,
	/** The order this checkout produced; `null` when it did not complete. */
	orderId: reference.nullable(),
	/** Amount actually charged. */
	charged: MoneyViewSchema,
	/** Where to send the buyer to finish a provider-side step; `null` otherwise. */
	nextActionUrl: z.string().max(600).nullable(),
	/** A display-ready outcome sentence. */
	message: z.string().max(200),
	/** What went wrong, when it did. */
	blockers: z.array(CheckoutBlockerSchema).max(20),
	/** The net movement against the wallet, when the wallet was the source; else `null`. */
	walletDelta: MoneyViewSchema.nullable(),
	at: timestamp,
});
export type CheckoutResult = z.infer<typeof CheckoutResultSchema>;
// #endregion

// #region Read query
/** A resolved checkout/basket read: which basket, in which currency, narrowed to which deep-link. */
export interface CheckoutQuery {
	/** The basket to read; `null` resolves the owner's default. */
	basketId?: string | null;
	/** `personal` or `{entity}:{id}` — whose money the basket spends; `null` resolves the active context. */
	owner?: string | null;
	/** The viewer's display currency; defaults to the basket's own. */
	display?: string | null;
	/** `?project_id=` narrowing. */
	projectId?: string | null;
	/** `?service_id=` narrowing. */
	serviceId?: string | null;
}
// #endregion
