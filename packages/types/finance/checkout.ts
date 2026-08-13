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
import {
	BillingContextSchema,
	buyerDetailsComplete,
	BuyerDetailsSchema,
	MonthlyInvoicingSchema,
} from "./buyer.ts";

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
	/**
	 * The buyer's **voluntary** contribution toward third-party gateway costs, in minor units; `0`
	 * when they have not opted in.
	 *
	 * Passed in, never derived — for the same reason {@link CheckoutTotalsInput.taxMinor} is. The
	 * gateway's actual cost on a given charge depends on the instrument, the issuing country and the
	 * scheme, none of which this module knows; a percentage invented here would be presented to the
	 * buyer as *the* processing cost and would be wrong. The server resolves it and the surface
	 * renders the resolved figure.
	 *
	 * It always **adds** to the buyer's total, under either {@link PlatformFeeMode}. That is what
	 * makes it a contribution rather than a fee: the buyer chose to pay something they did not owe,
	 * so it can never be quietly absorbed into a line they were already paying.
	 */
	processingContributionMinor?: number;
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
	/** The buyer's voluntary gateway contribution; `0` when they did not opt in. */
	processingContributionMinor: number;
	/**
	 * `net + tax + contribution`, plus the platform fee only when {@link feeMode} is `buyer_added`.
	 */
	totalMinor: number;
}

/**
 * The one place a checkout total is computed. Integer minor units end to end; no float ever enters the
 * chain, and rounding happens once, inside {@link platformFeeFor}.
 *
 * Order of operations: gross subtotal → creator discounts → promo → fee on the discounted base → tax
 * → voluntary contribution → total. The platform fee is added to the buyer's total **only** under
 * `buyer_added`; under the default `seller_deducted` it is reported for disclosure and the buyer pays
 * `net + tax + contribution`.
 *
 * The contribution is added last and is **never** part of the base the platform fee is charged on:
 * charging a percentage of a voluntary gift would make the buyer's generosity revenue, which is not
 * what the checkbox offers them.
 */
export function checkoutTotals(input: CheckoutTotalsInput): CheckoutTotalsMinor {
	const feeBp = input.platformFeeBp ?? PLATFORM_FEE_BP;
	const feeMode = input.feeMode ?? "seller_deducted";
	const taxMinor = Math.max(input.taxMinor ?? 0, 0);
	const processingContributionMinor = Math.max(input.processingContributionMinor ?? 0, 0);

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
		processingContributionMinor,
		totalMinor: discounts.netMinor + taxMinor + processingContributionMinor +
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
	/**
	 * The buyer's voluntary gateway contribution, as charged. Zero-valued rather than `null` when
	 * they declined, so the totals block has one shape and the line simply does not render.
	 */
	processingContribution: MoneyViewSchema,
	total: MoneyViewSchema,
});
export type CheckoutTotals = z.infer<typeof CheckoutTotalsSchema>;
// #endregion

// #region Processing contribution
/**
 * The voluntary "help cover gateway costs" offer.
 *
 * Three things this shape refuses to do, each for the same reason — the buyer is being asked for
 * money they do not owe, so every fact around the ask has to be true:
 *
 *  - It carries a server-computed {@link amount}, never a rate the client multiplies. The real cost
 *    depends on the instrument and the issuing country, so a client-side percentage would be a
 *    plausible number that is not the cost.
 *  - It carries {@link optedIn} explicitly rather than inferring it from a non-zero amount, so the
 *    surface can render an unchecked box beside a real figure ("adds £0.42") before the buyer agrees.
 *  - It carries its own {@link note}, so the tooltip's wording lives with the offer rather than
 *    being retyped on each surface that shows it.
 */
export const ProcessingContributionOfferSchema = z.object({
	/** Whether to render the offer at all. Some providers (a wallet payment) incur no gateway cost. */
	offered: z.boolean(),
	optedIn: z.boolean(),
	/** What opting in adds, server-computed. Zero-valued when not offered. */
	amount: MoneyViewSchema,
	/** The explanation shown in the control's tooltip. */
	note: z.string().max(240),
});
export type ProcessingContributionOffer = z.infer<typeof ProcessingContributionOfferSchema>;
// #endregion

// #region Spending limit
/**
 * How the acting member's spending limit bears on THIS basket.
 *
 * A projection over `finance.spending_limits` (`cap_cents`, `period_interval`, `spent_cents`,
 * `resets_at`) — no new storage, and deliberately **no arithmetic**.
 *
 * **The verdict is carried, never computed here.** The rule lives in `evaluateSpend`
 * (`@projective/types/workspace`), and this schema cannot call it: `workspace` already imports
 * `finance/wallet.ts`, so importing it back would close a cycle in the type graph. The FAT SERVICE
 * calls the one rule (it may import both domains freely) and puts its answer in this field — which
 * keeps a single implementation of the ceiling logic without making `finance` stop being a leaf.
 * There are already three views of this rule in the codebase; a fourth would be drift.
 *
 * `needs_approval` is a first-class outcome, which is why this is a verdict rather than a boolean:
 * a purchase over the ceiling is not refused, it is routed — and a boolean could not say so.
 */
export const SpendLimitBlockSchema = z.object({
	/** Whether a limit applies at all. `false` for a personal wallet — no cap, so no control. */
	applies: z.boolean(),
	/** `evaluateSpend`'s verdict for this basket's total, computed server-side. */
	verdict: z.enum(["allowed", "needs_approval", "blocked"]),
	/** The verdict's own sentence, so the surface never invents a reason. `null` when allowed. */
	reason: z.string().max(200).nullable(),
	/** `cap_cents` as money. */
	cap: MoneyViewSchema,
	/** `spent_cents` in the current window. */
	spent: MoneyViewSchema,
	/** What remains before the cap. Zero-valued, never negative. */
	remaining: MoneyViewSchema,
	/** `period_interval` as a phrase ("this month"); `null` when the cap is a lifetime total. */
	periodLabel: z.string().max(60).nullable(),
	/** Where a `needs_approval` request is raised; `null` otherwise. */
	requestHref: z.string().max(200).nullable(),
});
export type SpendLimitBlock = z.infer<typeof SpendLimitBlockSchema>;
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
	/**
	 * Delivery or billing details are incomplete.
	 *
	 * The mirror of {@link canSkipDetails}: a session that may not SKIP the Details step must also
	 * refuse Pay, or a deep link straight to `/checkout/payment` becomes a way around the form.
	 */
	"missing_details",
	/**
	 * The acting member's spending limit refuses or defers this purchase. Carries the verdict from
	 * {@link SpendLimitBlockSchema}, so `needs_approval` reaches the surface as a route forward
	 * rather than as a wall.
	 */
	"spend_limit",
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

	/**
	 * The buyer's saved delivery + billing details for the ACTIVE billing identity.
	 *
	 * Carried on the session rather than fetched separately by the Details page so that every step
	 * asks the same question of the same record: the auto-skip, the "Change details" summary on the
	 * payment step, and the invoice's billed-to block all read this one value. Two reads would be two
	 * answers, and the one that decided the skip would not be the one that printed the invoice.
	 */
	buyer: BuyerDetailsSchema,
	/** Every identity the buyer may bill through — the Details page's context switcher. */
	billingContexts: z.array(BillingContextSchema).max(20),
	/** The monthly-invoicing offer for the active identity, with its refusal reason when closed. */
	invoicing: MonthlyInvoicingSchema,
	/** The voluntary gateway-contribution offer. */
	processingOffer: ProcessingContributionOfferSchema,
	/** How the acting member's spending limit bears on this basket. */
	spendLimit: SpendLimitBlockSchema,
});
export type CheckoutSessionContext = z.infer<typeof CheckoutSessionContextSchema>;

/**
 * Whether this session may skip `/checkout/details`.
 *
 * Delegates to {@link buyerDetailsComplete} rather than re-testing the fields, so the redirect and
 * the form are one rule. Exported here because the ROUTE asks the question of a *session*, and
 * making it reach into the buyer record to ask it is how a second, subtly different test appears.
 */
export function canSkipDetails(session: CheckoutSessionContext): boolean {
	return buyerDetailsComplete(session.buyer);
}

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
	/**
	 * The buyer's voluntary gateway contribution, echoed from the offer they accepted.
	 *
	 * **This must travel with the write or every payment fails.** `create()` recomputes the total
	 * with {@link checkoutTotals} and refuses on any mismatch with {@link expectedTotalMinor}. The
	 * contribution is part of that total, so a client that added it to what it showed the buyer but
	 * did not send it here would produce a server total lower by exactly the contribution — and the
	 * refusal would be `price_changed`, on every single attempt, for a reason nothing on the surface
	 * could explain.
	 */
	processingContributionMinor: minorUnitsNonNeg.default(0),
	/** Which billing identity to invoice — `personal`, or the entity key (`business:{id}`). */
	billingContextId: reference.optional(),
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
