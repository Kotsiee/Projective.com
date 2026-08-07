import type {
	BasketItem,
	CheckoutBlocker,
	CheckoutResult,
	CheckoutSessionContext,
	CheckoutTotals,
	CreateCheckout,
	PaymentProvider,
	ProviderAvailability,
	SavedCard,
} from "@projective/types/finance";
import {
	availableProviders,
	checkoutRequirements,
	checkoutTotals,
	isCheckoutEligible,
	itemKindMeta,
	PLATFORM_FEE_BP,
} from "@projective/types/finance";
import { ok, type ServiceResult } from "../ServiceResult.ts";
import { isFinanceBackendLive } from "../../core/supabase.ts";
import type { BasketQuery } from "./basket-query.ts";
import * as fx from "./basket-fixtures.ts";
import { defaultCardId, findCard, listCards } from "./cards-fixtures.ts";

/**
 * CheckoutBackendService — the FAT half of the payment surface: the whole server projection the
 * checkout page renders ({@link session}) and the charge itself ({@link create}), each returning a
 * transport-agnostic {@link ServiceResult}.
 *
 * **Every total on this platform is computed by the SSOT's one arithmetic path.** `checkoutTotals`
 * (which itself runs `basketSubtotal` → `applyDiscounts` → `platformFeeFor`) returns integer minor
 * units; this service's only job with them is to wrap them into `MoneyView`s with a server-rendered
 * display string. There is deliberately no second subtotal, no second fee calculation and no second
 * eligibility rule anywhere in this module — a second implementation is how two surfaces come to round
 * a fee differently and only one of them is what the buyer is charged.
 *
 * **The provider offer is a pure function of the context, and a refused provider is never hidden.**
 * `availableProviders` returns all six in enum order, each with `available` and a human-readable
 * `reason`, so an individual attempting to spend a business's money sees *why* every route is closed
 * rather than an empty payment section. The three rules it binds — an individual may not purchase on an
 * entity's behalf; an entity may only spend from its Projective wallet or a verified business card;
 * invoicing requires KYB Level 3 — are the SSOT's, applied here against the resolved owner.
 *
 * **{@link create} is idempotent and re-verifies the price.** A retried submit, a double-click or a
 * reconnect after a dropped response replays the stored outcome for the same `idempotencyKey` instead
 * of charging twice; and the client-supplied `expectedTotalMinor` is checked against a freshly computed
 * total, refusing on mismatch — a client-supplied total the server accepts blindly is a price-tampering
 * hole.
 *
 * Gated by {@link isFinanceBackendLive} (`FINANCE_BACKEND_LIVE`, default off): until the RLS-scoped
 * `finance.*` money functions, the Stripe PaymentIntent path and the idempotency ledger are wired, the
 * session answers from the basket fixtures and a charge mutates the in-module session store (fully
 * exercisable, no persistence, no money moved).
 */

// #region Session
/** Where a checkout's non-money display facts come from, resolved once and shared by both entry points. */
interface Resolved {
	owner: fx.ResolvedOwner;
	items: BasketItem[];
	cards: SavedCard[];
	walletMinor: number;
	basketId: string;
}

/** Narrow a basket's lines to what a checkout is paying for: active lines, then the deep-link. */
function narrow(
	items: readonly BasketItem[],
	projectId: string | null,
	serviceId: string | null,
): BasketItem[] {
	return items.filter((item) => {
		if (item.savedForLater) return false;
		if (projectId && item.metadata.projectId !== projectId) return false;
		if (serviceId && item.metadata.serviceId !== serviceId) return false;
		return true;
	});
}

/** Wrap the SSOT's integer totals into the display-currency {@link CheckoutTotals} projection. */
function toTotals(
	items: readonly BasketItem[],
	promoMinor: number,
	display: string,
): CheckoutTotals {
	const t = checkoutTotals({ items, promoDiscountMinor: promoMinor });
	const money = (minor: number) => fx.money(minor, display);
	return {
		subtotal: money(t.subtotalMinor),
		creatorDiscounts: money(t.creatorDiscountMinor),
		promoDiscount: money(t.promoDiscountMinor),
		net: money(t.netMinor),
		platformFee: money(t.platformFeeMinor),
		platformFeeBp: t.platformFeeBp,
		platformFeeMode: t.feeMode,
		taxes: money(t.taxMinor),
		// No tax engine has been wired, so no tax is asserted. A fabricated rate would look
		// authoritative and be wrong; the SSOT takes tax as an INPUT for exactly this reason.
		taxNote: null,
		total: money(t.totalMinor),
	};
}

/**
 * Everything currently preventing payment, in the order a buyer can act on it. Line-level obstacles
 * name the line responsible; account-level ones carry `itemId: null`.
 */
function blockersFor(
	resolved: Resolved,
	providers: readonly ProviderAvailability[],
): CheckoutBlocker[] {
	const { owner, items } = resolved;
	const blockers: CheckoutBlocker[] = [];

	if (owner.isEntity && !owner.actingIsMember) {
		blockers.push({
			code: "not_authorised",
			message:
				"Only a member of this account can pay from it. Switch to your personal account to buy this yourself.",
			itemId: null,
		});
	}

	const eligible = items.filter(isCheckoutEligible);
	if (eligible.length === 0) {
		blockers.push({
			code: "empty",
			message: "Nothing is selected for checkout yet. Pick at least one item to continue.",
			itemId: null,
		});
	}

	for (const item of items) {
		if (!item.isSelectedForCheckout || item.savedForLater) continue;
		if (!item.available) {
			blockers.push({
				code: "unavailable_item",
				message: item.unavailableReason ??
					`${item.title} isn't available any more. Remove it or save it for later.`,
				itemId: item.id,
			});
		}
	}

	for (const item of eligible) {
		const meta = itemKindMeta(item.itemType);
		if (meta.needsEmail && !item.destinationEmail) {
			blockers.push({
				code: "missing_email",
				message: `Add the address ${item.title} should be delivered to.`,
				itemId: item.id,
			});
		}
		if (meta.needsSchedule && !item.scheduledAt) {
			blockers.push({
				code: "missing_schedule",
				message: `Pick a time for ${item.title} before paying.`,
				itemId: item.id,
			});
		}
		if (meta.needsStage && !item.stageId) {
			blockers.push({
				code: "missing_stage",
				message: `Choose which stage ${item.title} runs through.`,
				itemId: item.id,
			});
		}
	}

	// KYB gates OPERATING a pooled entity wallet (finance-model.md §KYC/KYB Gating). The SSOT's
	// provider function gates only `invoice` on KYB, so the broader gate is expressed here as a
	// blocker rather than by forking that function.
	if (owner.isEntity && owner.kybStatus !== null && owner.kybStatus !== "verified") {
		blockers.push({
			code: "verification_required",
			message: owner.kybStatus === "pending"
				? "Business verification (KYB) is still in review — you can pay once it clears."
				: "Complete business verification (KYB) to pay from this account.",
			itemId: null,
		});
	}

	if (
		eligible.length > 0 && owner.actingIsMember && !providers.some((p) => p.available)
	) {
		blockers.push({
			code: "no_provider",
			message: "No payment method is available for this account right now.",
			itemId: null,
		});
	}

	return blockers.slice(0, 20);
}

/** Resolve the shared inputs both entry points need. */
function resolve(query: BasketQuery): Resolved {
	const owner = fx.resolveOwner(query);
	const basket = fx.basketFor(owner, query.basketId);
	return {
		owner,
		basketId: basket.id,
		items: narrow(basket.items, query.projectId ?? null, query.serviceId ?? null),
		cards: listCards(owner, query.sim?.cards),
		walletMinor: fx.walletAvailableMinor(owner, query),
	};
}

/**
 * Build the provider offer for a resolved checkout at a given total.
 *
 * The simulated preset moves the **inputs** `availableProviders` is evaluated against — never its
 * verdict. Overriding the verdict would put a second copy of the eligibility rules in the codebase,
 * and the whole point of the preset is to exercise the real ones from an angle a developer cannot
 * otherwise reach: `invoice` lifts the account to the KYB tier the SSOT gates invoicing on, and
 * `card_only` withdraws the wallet and both device wallets so the card path is the only one left
 * standing — each still refused, or offered, by the same function every real request runs through.
 */
function offerFor(resolved: Resolved, totalMinor: number, sim: BasketQuery["sim"]) {
	const preset = sim?.providers;
	const deviceWallets = preset === "all"
		? { googlePay: true, applePay: true }
		: preset === "card_only" || preset === "no_wallet" || preset === "invoice"
		? { googlePay: false, applePay: false }
		: { googlePay: sim?.googlePay, applePay: sim?.applePay };
	const paypalEnabled = preset === "all"
		? true
		: preset === "card_only" || preset === "invoice"
		? false
		: sim?.paypalEnabled;
	const invoiceable = preset === "invoice" || preset === "all";

	return availableProviders({
		ownerType: resolved.owner.ownerType,
		actingIsMember: resolved.owner.actingIsMember,
		walletAvailableMinor: preset === "no_wallet" || preset === "card_only"
			? 0
			: resolved.walletMinor,
		totalMinor,
		currency: resolved.owner.display,
		savedCards: resolved.cards,
		kybStatus: invoiceable ? "verified" : resolved.owner.kybStatus,
		verificationTier: invoiceable ? 3 : resolved.owner.verificationTier,
		deviceWallets,
		paypalEnabled,
	});
}
// #endregion

export class CheckoutBackendService {
	/**
	 * The checkout page's entire server projection — which account is paying, which lines are being paid
	 * for, what each provider costs the buyer in eligibility, what the wallet covers, the totals, and
	 * everything currently blocking Pay.
	 *
	 * Takes the SSOT's `CheckoutQuery` widened with the viewer identity the fixtures scope on; a bare
	 * `CheckoutQuery` is still assignable, so the published signature holds.
	 */
	static session(query: BasketQuery): ServiceResult<{ session: CheckoutSessionContext }> {
		if (isFinanceBackendLive()) {
			// LIVE: read the basket + saved cards + wallet balance under the caller's JWT, then apply the
			// SAME SSOT arithmetic and provider rules — not yet implemented; fall back to fixtures.
		}
		const resolved = resolve(query);
		const { owner, items } = resolved;
		const promo = fx.resolvePromo(
			fx.activePromoCode(owner, query.basketId),
			items,
			owner.display,
		);
		const totals = toTotals(items, fx.promoMinorFor(promo), owner.display);
		// The coverage axis is relative to the TOTAL, so it can only be applied once the total exists —
		// and it must be applied before the offer, or the wallet provider would be judged against a
		// balance the surface is about to contradict.
		const walletMinor = fx.simWalletMinor(resolved.walletMinor, totals.total.minor, query.sim);
		const covered: Resolved = { ...resolved, walletMinor };
		const providers = offerFor(covered, totals.total.minor, query.sim);
		const shortfall = Math.max(totals.total.minor - walletMinor, 0);
		const requirements = checkoutRequirements(items);

		return ok({
			session: {
				basketId: resolved.basketId,
				owner: {
					ownerType: owner.ownerType,
					ownerId: owner.ownerId,
					name: owner.name,
					handle: owner.handle,
					avatar: owner.avatar,
					actingIsMember: owner.actingIsMember,
				},
				currency: owner.display,
				items,
				groups: fx.buildGroups(items, owner.display),
				preselect: {
					projectId: query.projectId ?? null,
					serviceId: query.serviceId ?? null,
				},
				// The buyer has not chosen yet — the surface selects from `providers`.
				provider: null,
				providers,
				wallet: {
					available: fx.money(walletMinor, owner.display),
					shortfall: fx.money(shortfall, owner.display),
					covers: shortfall === 0,
				},
				savedCards: resolved.cards,
				defaultCardId: defaultCardId(owner, query.sim?.cards),
				promo,
				totals,
				requiresEmail: requirements.requiresEmail,
				requiresSchedule: requirements.requiresSchedule,
				requiresStage: requirements.requiresStage,
				blockers: blockersFor(covered, providers),
			},
		});
	}

	/**
	 * Charge a checkout.
	 *
	 * Idempotent on `idempotencyKey`: the first attempt's outcome is stored and replayed verbatim for
	 * any repeat, so a double-click or a retried request after a dropped response cannot charge twice.
	 * The submitted `expectedTotalMinor` and `currency` are re-verified against a freshly computed total
	 * before anything moves.
	 */
	static create(
		input: CreateCheckout,
		query: BasketQuery,
	): ServiceResult<{ result: CheckoutResult }> {
		const replay = IDEMPOTENT.get(input.idempotencyKey);
		if (replay) {
			return ok({ result: replay }, {
				message: "This payment was already processed — showing the original outcome.",
			});
		}
		const result = charge(input, query);
		IDEMPOTENT.set(input.idempotencyKey, result);
		return ok({ result }, { message: result.message });
	}
}

// #region Charging
/** The idempotency ledger — one stored outcome per client-minted key, replayed on any repeat. */
const IDEMPOTENT = new Map<string, CheckoutResult>();

/** A refusal outcome carrying its blockers. */
function refuse(
	message: string,
	blockers: CheckoutBlocker[],
	display: string,
): CheckoutResult {
	return {
		status: "failed",
		orderId: null,
		charged: fx.money(0, display),
		nextActionUrl: null,
		message,
		blockers,
		walletDelta: null,
		at: new Date(fx.referenceNow()).toISOString(),
	};
}

/**
 * Whether the submitted owner is the account this request may actually spend from. The personal scope
 * accepts either `user` or `freelancer` — the same human, labelled by capability — while an entity must
 * match exactly.
 */
function ownerMatches(input: CreateCheckout, owner: fx.ResolvedOwner): boolean {
	if (input.ownerId !== owner.ownerId) return false;
	if (owner.isEntity) return input.ownerType === owner.ownerType;
	return input.ownerType === "user" || input.ownerType === "freelancer";
}

/** The outcome status + wording a provider produces on a successful submission. */
function outcomeFor(
	provider: PaymentProvider,
	totalMinor: number,
	display: string,
): { status: CheckoutResult["status"]; message: string; nextActionUrl: string | null } {
	const amount = fx.money(totalMinor, display).display;
	switch (provider) {
		case "paypal":
			return {
				status: "requires_action",
				message: `Approve ${amount} with PayPal to finish this purchase.`,
				nextActionUrl: "https://www.paypal.com/checkoutnow?token=XXXX-XXXX",
			};
		case "invoice":
			return {
				status: "pending",
				message: `Invoice raised for ${amount}. It's due on your usual terms.`,
				nextActionUrl: null,
			};
		default:
			return { status: "succeeded", message: `Paid ${amount}.`, nextActionUrl: null };
	}
}

/** Run one checkout attempt. Pure of transport; every refusal names what to fix. */
function charge(input: CreateCheckout, query: BasketQuery): CheckoutResult {
	const resolved = resolve({ ...query, basketId: input.basketId });
	const { owner } = resolved;
	const display = owner.display;

	if (!ownerMatches(input, owner)) {
		return refuse(
			"You can't pay from that account in this session. Switch to it and try again.",
			[{
				code: "not_authorised",
				message:
					"This checkout was submitted for a different account than the one you're acting as.",
				itemId: null,
			}],
			display,
		);
	}

	const wanted = new Set(input.itemIds);
	const chosen = resolved.items.filter((item) => wanted.has(item.id));
	const eligible = chosen.filter(isCheckoutEligible);

	// Blockers are computed against the SUBMITTED lines, not the whole basket: a line the buyer left
	// out of this payment must not block it.
	const scoped: Resolved = { ...resolved, items: chosen };
	if (eligible.length === 0) {
		return refuse(
			"None of those items can be paid for right now.",
			blockersFor(scoped, []),
			display,
		);
	}

	const promo = fx.resolvePromo(input.promoCode, eligible, display);
	const totals = toTotals(eligible, fx.promoMinorFor(promo), display);
	// Same ordering as `session`: the coverage axis is relative to the total, so the wallet is settled
	// before the offer is built — otherwise a charge could be judged against a balance the checkout
	// page had already shown differently.
	const walletMinor = fx.simWalletMinor(scoped.walletMinor, totals.total.minor, query.sim);
	const priced: Resolved = { ...scoped, items: eligible, walletMinor };
	const providers = offerFor(priced, totals.total.minor, query.sim);

	const blocking = blockersFor(priced, providers);
	if (blocking.length > 0) {
		return refuse(blocking[0].message, blocking, display);
	}

	// #region Provider + instrument
	const offer = providers.find((p) => p.provider === input.provider);
	if (!offer || !offer.available) {
		const code = input.provider === "wallet" ? "insufficient_funds" : "no_provider";
		return refuse(
			offer?.reason ?? "That payment method isn't available for this account.",
			[{
				code,
				message: offer?.reason ?? "That payment method isn't available for this account.",
				itemId: null,
			}],
			display,
		);
	}
	if (input.provider === "card") {
		if (!input.cardId) {
			return refuse("Choose a card to pay with.", [{
				code: "no_provider",
				message: "Choose a card to pay with.",
				itemId: null,
			}], display);
		}
		const card = findCard(owner, input.cardId, query.sim?.cards);
		if (!card) {
			return refuse("That card is no longer on file. Choose another one.", [{
				code: "no_provider",
				message: "That card is no longer on file. Choose another one.",
				itemId: null,
			}], display);
		}
		if (card.isExpired) {
			return refuse("That card has expired. Choose another one or add a new card.", [{
				code: "no_provider",
				message: "That card has expired. Choose another one or add a new card.",
				itemId: null,
			}], display);
		}
		if (owner.isEntity && !card.isBusinessCard) {
			return refuse(
				"A business purchase must be paid from the business wallet or a business card.",
				[{
					code: "not_authorised",
					message: "A personal card can't pay for a business purchase.",
					itemId: null,
				}],
				display,
			);
		}
	}
	// #endregion

	// #region Price re-verification (the anti-tampering check)
	// Both stale-basket refusals carry a `price_changed` blocker as well as a message. A surface that
	// explains a refusal by rendering `blockers` would otherwise show nothing on the two refusals a
	// buyer is most likely to hit — the reason would exist only in a field that surface never reads.
	if (input.currency.toUpperCase() !== display.toUpperCase()) {
		const message =
			`This basket is priced in ${display}, not ${input.currency.toUpperCase()}. Reload and try again.`;
		return refuse(message, [{ code: "price_changed", message, itemId: null }], display);
	}
	if (input.expectedTotalMinor !== totals.total.minor) {
		const message =
			`The price changed while you were paying — it's now ${totals.total.display}. Review the total and try again.`;
		return refuse(message, [{ code: "price_changed", message, itemId: null }], display);
	}
	// #endregion

	const outcome = outcomeFor(input.provider, totals.total.minor, display);
	if (outcome.status === "succeeded") {
		fx.markPurchased(owner, resolved.basketId, eligible.map((i) => i.id));
	}
	return {
		status: outcome.status,
		// No orders table exists yet, so there is no order to name. A fabricated id would be a
		// reference the buyer could not look up.
		orderId: null,
		charged: fx.money(outcome.status === "succeeded" ? totals.total.minor : 0, display),
		nextActionUrl: outcome.nextActionUrl,
		message: outcome.message,
		blockers: [],
		walletDelta: input.provider === "wallet" && outcome.status === "succeeded"
			? fx.money(-totals.total.minor, display)
			: null,
		at: new Date(fx.referenceNow()).toISOString(),
	};
}
// #endregion

/**
 * The canonical platform fee rate this surface quotes, re-exported so a caller can label the fee line
 * without importing the SSOT twice. The DB's `security.platform_params.platform_fee_bp` is seeded `0`
 * while this constant is `500` (5%) — an open human decision logged in root CLAUDE.md; the SSOT
 * constant wins here until it is settled.
 */
export { PLATFORM_FEE_BP };
