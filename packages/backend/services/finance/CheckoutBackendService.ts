import { isPaymentsLive } from "../../core/stripe.ts";
import { PaymentBackendService } from "./PaymentBackendService.ts";
import type {
	BasketItem,
	BillingContext,
	BuyerDetails,
	CheckoutBlocker,
	CheckoutResult,
	CheckoutSessionContext,
	CheckoutTotals,
	CreateCheckout,
	MoneyView,
	MonthlyInvoicing,
	ProviderAvailability,
	ProviderContext,
	SaveBuyerDetails,
	SavedCard,
	SpendLimitBlock,
} from "@projective/types/finance";
import {
	availableProviders,
	buyerDetailsComplete,
	checkoutRequirements,
	checkoutTotals,
	DEFAULT_LOCALE,
	formatMoney,
	isCheckoutEligible,
	itemKindMeta,
	missingBuyerFields,
	PLATFORM_FEE_BP,
} from "@projective/types/finance";
import { AGE_RESTRICTED, isAgeRestricted } from "../../core/age-gate.ts";
import { getUserClient } from "../../core/supabase.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import type { BasketQuery } from "./basket-query.ts";
import type { MoneyProjector } from "./commerce-money.ts";
import { listOwners, type ResolvedOwner, walletAvailableMinor } from "./commerce-owner.ts";
import { type BasketView, promoMinorFor, readBasket } from "./live-basket.ts";
import { defaultCardOf, listCards } from "./live-cards.ts";
import {
	billingContextsFor,
	buyerDetailsFor,
	departmentsOf,
	processingOfferFor,
	saveBuyerDetails,
	spendLimitFor,
} from "./live-buyer.ts";

/**
 * CheckoutBackendService — the FAT half of the payment surface: the whole server projection the
 * checkout page renders ({@link session}), the Details step's record ({@link details},
 * {@link saveDetails}), and the charge itself ({@link create}), each returning a transport-agnostic
 * {@link ServiceResult}.
 *
 * Everything reads LIVE as the signed-in caller: the basket (`live-basket`), the paying account and
 * its wallet (`commerce-owner`), its saved cards (`live-cards`), the buyer's saved details and the
 * member's spending limit (`live-buyer`).
 *
 * **Every total on this platform is computed by the SSOT's one arithmetic path.** `checkoutTotals`
 * (which itself runs `basketSubtotal` → `applyDiscounts` → `platformFeeFor`) returns integer minor
 * units; this service's only job with them is to wrap them into `MoneyView`s. There is deliberately no
 * second subtotal, no second fee calculation and no second eligibility rule anywhere in this module.
 *
 * **The provider offer is a pure function of the context, and a refused provider is never hidden.**
 * `availableProviders` returns all six in enum order, each with `available` and a human-readable
 * `reason`, applied here against the resolved owner.
 */

// #region Payment processor
/**
 * Whether the card processor (the Stripe fiat rails, Decision #125/#126) is connected to this
 * deployment: `FINANCE_BACKEND_LIVE` AND a well-formed Stripe key. When it is, `card` and `express`
 * settle here — each as a top-up of the paying wallet followed by a wallet order
 * (`createCheckoutCardPayment`). `express` is Stripe's Express Checkout Element (Apple Pay, Google Pay,
 * PayPal — whichever the device and the account can show, Decision #153); when the processor is not
 * connected both routes are refused with the reason, never offered as controls that cannot take the
 * money (root CLAUDE.md §3 gate 11).
 */
function processorConnected(): boolean {
	return isPaymentsLive();
}

/** The project kinds a line may buy ONE board ticket as (Decision #166). */
const TICKET_KINDS: ReadonlySet<BasketItem["itemType"]> = new Set([
	"project_ticket",
	"one_off_project",
	"one_off_task",
]);

/** The 1-1 kinds a booked time settles into a seat with per-sitting escrow (Decision #211). */
const SESSION_KINDS: ReadonlySet<BasketItem["itemType"]> = new Set([
	"service_session",
	"set_session",
]);

/**
 * Whether the wallet — and so a card or express top-up of it — can settle this line in one transaction
 * (`finance.place_wallet_order`): a digital product, or ONE board ticket, which settles by holding that
 * ticket's escrow from the wallet rather than by a sale (Decision #166), or a paid revision round, held
 * the same way on its ticket (Decision #167), or a cohort seat carrying its reservation (`holdId`,
 * Decision #171), held as the seat's escrow, or a 1-1 session or set-session block carrying its picked
 * time, held as one escrow per sitting (Decision #211). A whole project or a service still escrows
 * against something a basket line does not carry.
 */
function walletSettles(item: BasketItem): boolean {
	return item.itemType === "digital_product" || item.itemType === "paid_revision" ||
		(!!item.ticketId && TICKET_KINDS.has(item.itemType)) ||
		(item.itemType === "course_group_session" && typeof item.metadata.holdId === "string") ||
		(SESSION_KINDS.has(item.itemType) && !!item.scheduledAt);
}
// #endregion

// #region Session
/** Where a checkout's facts come from, resolved once and shared by every entry point. */
interface Resolved {
	view: BasketView;
	owner: ResolvedOwner;
	money: MoneyProjector;
	items: BasketItem[];
	cards: SavedCard[];
	walletMinor: number;
	basketId: string;
	/** A business's standing for paying on account, in the display currency; `null` for anyone else. */
	onAccount: ProviderContext["onAccount"];
}

/** Narrow a basket's lines to what a checkout is paying for: active lines, then the deep link. */
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

/**
 * The fee rate a checkout previews: the paying owner's effective rate from the server
 * (`get_purchase_owner`), the rate `place_wallet_order` will charge; the SSOT constant labels only an
 * owner whose rate the caller may not see.
 */
function feeBpOf(owner: ResolvedOwner): number {
	return owner.platformFeeBp ?? PLATFORM_FEE_BP;
}

/** Wrap the SSOT's integer totals into the display-currency {@link CheckoutTotals} projection. */
function toTotals(
	items: readonly BasketItem[],
	promoMinor: number,
	money: MoneyProjector,
	platformFeeBp: number,
	processingContributionMinor = 0,
): CheckoutTotals {
	const t = checkoutTotals({
		items,
		promoDiscountMinor: promoMinor,
		platformFeeBp,
		processingContributionMinor,
	});
	return {
		subtotal: money.derived(t.subtotalMinor),
		creatorDiscounts: money.derived(t.creatorDiscountMinor),
		promoDiscount: money.derived(t.promoDiscountMinor),
		net: money.derived(t.netMinor),
		platformFee: money.derived(t.platformFeeMinor),
		platformFeeBp: t.platformFeeBp,
		platformFeeMode: t.feeMode,
		taxes: money.derived(t.taxMinor),
		// No tax engine has been wired, so no tax is asserted. A fabricated rate would look
		// authoritative and be wrong; the SSOT takes tax as an INPUT for exactly this reason.
		taxNote: null,
		processingContribution: money.derived(t.processingContributionMinor),
		total: money.derived(t.totalMinor),
	};
}

/** The two account-level gates resolved AFTER the total exists. */
interface CheckoutGate {
	/** The buyer's saved delivery + billing record for the paying account. */
	buyer?: BuyerDetails;
	/** How the acting member's spending limit bears on this basket's total. */
	spendLimit?: SpendLimitBlock;
}

/**
 * Everything currently preventing payment, in the order a buyer can act on it. Line-level obstacles
 * name the line responsible; account-level ones carry `itemId: null`.
 */
function blockersFor(
	resolved: Pick<Resolved, "owner" | "items">,
	providers: readonly ProviderAvailability[],
	gate: CheckoutGate = {},
): CheckoutBlocker[] {
	const { owner, items } = resolved;
	const blockers: CheckoutBlocker[] = [];

	if (owner.isEntity && !owner.actingIsMember) {
		blockers.push({
			code: "not_authorised",
			message:
				"Only a member who can spend from this account can pay from it. Switch to your personal account to buy this yourself.",
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
		// Said before Pay rather than refused at it: the wallet (topped up by card when it must be) pays
		// for digital products and single board tickets — every other kind escrows against something a
		// basket line does not carry. A 1-1 session missing its time is told so by `missing_schedule` below.
		if (!walletSettles(item) && !SESSION_KINDS.has(item.itemType)) {
			blockers.push({
				code: "no_provider",
				message: item.itemType === "course_group_session"
					? `Reserve a seat for ${item.title} from its listing before paying.`
					: `${item.title} can't be paid for here yet — only digital products, project tickets, reserved seats and booked sessions can. Save it for later to pay for the rest.`,
				itemId: item.id,
			});
		}
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

	// The mirror of `canSkipDetails`: a session that may not SKIP the Details step must also refuse
	// Pay, or a deep link straight to `/checkout/payment` becomes a way around the form.
	if (eligible.length > 0 && gate.buyer && !buyerDetailsComplete(gate.buyer)) {
		const missing = missingBuyerFields(gate.buyer);
		blockers.push({
			code: "missing_details",
			message: missing.length > 0
				? `Add your delivery and billing details to continue — ${missing[0].label} is still missing.`
				: "Confirm your delivery and billing details to continue.",
			itemId: null,
		});
	}

	if (gate.spendLimit?.applies && gate.spendLimit.verdict !== "allowed") {
		blockers.push({
			code: "spend_limit",
			message: gate.spendLimit.reason ??
				(gate.spendLimit.verdict === "needs_approval"
					? "This purchase needs approval before it can be paid for."
					: "This purchase is over your spending limit for this account."),
			itemId: null,
		});
	}

	// KYB gates OPERATING a pooled business wallet (finance-model.md §KYC/KYB Gating). A team is not
	// subject to it, and its `kybStatus` is `null` for exactly that reason.
	if (owner.isEntity && owner.kybStatus !== null && owner.kybStatus !== "verified") {
		blockers.push({
			code: "verification_required",
			message: owner.kybStatus === "pending"
				? "Business verification (KYB) is still in review — you can pay once it clears."
				: "Complete business verification (KYB) to pay from this account.",
			itemId: null,
		});
	}

	if (eligible.length > 0 && owner.actingIsMember && !providers.some((p) => p.available)) {
		blockers.push({
			code: "no_provider",
			message: "No payment method is available for this account right now.",
			itemId: null,
		});
	}

	return blockers.slice(0, 20);
}

/**
 * What this environment can actually settle, applied over the SSOT's account-level offer.
 *
 * A processor-backed route (a card, the express wallets) is refused with the processor reason when the
 * processor is not connected, whatever the account rules said — including when they would have said
 * "add a card", which would send the buyer to a control that refuses them next. Invoicing needs no
 * processor — it is an on-account credit and a wallet order (`finance.place_on_account_order`), billed
 * on the business's monthly invoice — so its account-level answer stands as given.
 *
 * **The display currency no longer gates a card** (Decision #153, resolving #126(g)). A processor
 * charge is made in the listings' own currency and the buyer is SHOWN that figure — the session's
 * `charge`, beside the total in their own currency — so there is nothing left to switch.
 */
function settleableHere(offer: ProviderAvailability[]): ProviderAvailability[] {
	const connected = processorConnected();
	return offer.map((entry) => {
		if (PROCESSOR_ROUTES.has(entry.provider) && !connected) {
			return { ...entry, available: false, reason: PROCESSOR_REASON };
		}
		return entry;
	});
}

const PROCESSOR_ROUTES: ReadonlySet<ProviderAvailability["provider"]> = new Set(["card", "express"]);
const PROCESSOR_REASON =
	"Needs a payment processor, which isn't connected in this environment — pay from your Projective wallet.";

/** The one currency a card would be charged in — every line's own — or null when the lines mix currencies. */
function chargeCurrencyOf(items: readonly BasketItem[]): string | null {
	let currency: string | null = null;
	for (const item of items) {
		const own = (item.unitPrice.origin?.currency ?? item.unitPrice.currency).toUpperCase();
		if (currency !== null && currency !== own) return null;
		currency = own;
	}
	return currency;
}

/** The provider offer for a resolved checkout at a given total. */
function offerFor(resolved: Resolved, totalMinor: number): ProviderAvailability[] {
	return settleableHere(availableProviders({
		ownerType: resolved.owner.ownerType,
		actingIsMember: resolved.owner.actingIsMember,
		walletAvailableMinor: resolved.walletMinor,
		totalMinor,
		currency: resolved.money.display,
		savedCards: resolved.cards,
		kybStatus: resolved.owner.kybStatus,
		verificationTier: resolved.owner.verificationTier,
		onAccount: resolved.onAccount,
	}));
}

/**
 * What a card or express payment charges for these lines: the order total in the listings' OWN
 * currency (Decision #153).
 *
 * The figure is not a conversion of the display total — that would be a third number nobody priced.
 * It is the SAME basket read in the currency the sellers priced in, narrowed to the same lines and
 * totalled by the same `toTotals` (so the same promo resolution, the same discounts, the same
 * rounding): exactly what a buyer reading the basket in that currency would see as their total, and
 * exactly what `finance.place_wallet_order` debits when the order is then paid from the topped-up
 * wallet. When the display currency already IS that currency, the display total is returned as-is and
 * no second read is made. `null` when the lines span more than one currency — no single charge exists.
 *
 * The voluntary contribution is never part of it: `create` refuses a contribution on every route, so
 * a charge that included one would be a figure no payment can be made for.
 */
async function chargeFor(
	query: BasketQuery,
	actor: ReadActor,
	resolved: Pick<Resolved, "basketId" | "money" | "owner">,
	items: readonly BasketItem[],
	displayTotal: () => MoneyView,
): Promise<MoneyView | null> {
	const currency = chargeCurrencyOf(items.filter(isCheckoutEligible));
	if (currency === null) return null;
	if (currency === resolved.money.display) return displayTotal();

	const read = await readBasket({ ...query, basketId: resolved.basketId, display: currency }, actor);
	if (!read.ok) return null;
	const native = read.value;
	if (native.money.display !== currency) return null;
	const wanted = new Set(items.map((item) => item.id));
	const lines = native.basket.items.filter((item) => wanted.has(item.id));
	if (lines.length !== wanted.size) return null;
	const promo = await native.resolvePromo(native.promoCode, lines);
	return toTotals(lines, promoMinorFor(promo), native.money, feeBpOf(resolved.owner), 0).total;
}

/** Resolve the shared inputs every entry point needs. `null` for a caller who cannot be identified. */
async function resolve(query: BasketQuery, actor: ReadActor): Promise<Resolved | null> {
	const read = await readBasket(query, actor);
	if (!read.ok) return null;
	const view = read.value;
	const [cards, walletMinor, onAccount] = await Promise.all([
		listCards(view.owner, actor),
		walletAvailableMinor(view.owner, view.money, actor),
		onAccountStanding(view.owner, view.money.display, actor),
	]);
	return {
		view,
		owner: view.owner,
		money: view.money,
		basketId: view.basket.id,
		items: narrow(view.basket.items, query.projectId ?? null, query.serviceId ?? null),
		cards,
		walletMinor,
		onAccount,
	};
}

/**
 * A business's standing for paying on account (`finance.get_on_account_standing`), read as the caller.
 * `null` for a person, a team or an enterprise, and on any failure — the Invoice route then reads as
 * unavailable, and `finance.place_on_account_order` re-checks every gate at payment anyway.
 */
async function onAccountStanding(
	owner: ResolvedOwner,
	currency: string,
	actor: ReadActor,
): Promise<ProviderContext["onAccount"]> {
	if (owner.ownerType !== "business" || !actor.accessToken) return null;
	const { data, error } = await getUserClient(actor.accessToken).schema("finance")
		.rpc("get_on_account_standing", { p_business_id: owner.ownerId, p_currency: currency });
	if (error || !data) return null;
	const s = data as { monthly?: unknown; overdue?: unknown; headroom_minor?: unknown };
	return {
		monthly: s.monthly === true,
		overdue: s.overdue === true,
		headroomMinor: Number(s.headroom_minor) || 0,
	};
}

/**
 * The Details step's payload — one record, every identity it could be billed through, and the
 * monthly-invoicing offer for the paying account.
 */
export interface DetailsPayload {
	buyer: BuyerDetails;
	billingContexts: BillingContext[];
	invoicing: MonthlyInvoicing;
}

async function detailsFor(
	owner: ResolvedOwner,
	query: BasketQuery,
	actor: ReadActor,
): Promise<DetailsPayload> {
	const owners = await listOwners(query, actor);
	const self = owners.find((o) => !o.isEntity) ?? null;
	const buyer = await buyerDetailsFor(owner, actor, owner.display, self);
	return {
		buyer,
		billingContexts: await billingContextsFor(owners, actor, owner.display),
		invoicing: buyer.invoicing,
	};
}

const SIGNED_OUT = fail(401, { message: "Sign in to check out." });
const UNREACHABLE = fail(503, {
	message: "We couldn't reach your checkout just now. Try again in a moment.",
});

/** Run a checkout read; any unexpected failure is a 503, never a throw into the route. */
async function guarded<T>(label: string, run: () => Promise<ServiceResult<T>>): Promise<ServiceResult<T>> {
	try {
		return await run();
	} catch (error) {
		console.error(`[checkout:${label}]`, error instanceof Error ? error.message : error);
		return UNREACHABLE as ServiceResult<T>;
	}
}
// #endregion

export class CheckoutBackendService {
	/**
	 * The checkout page's entire server projection — which account is paying, which lines are being paid
	 * for, what each provider costs the buyer in eligibility, what the wallet covers, the totals, and
	 * everything currently blocking Pay.
	 */
	static session(
		query: BasketQuery,
		actor: ReadActor,
	): Promise<ServiceResult<{ session: CheckoutSessionContext }>> {
		return guarded("session", async () => {
			const resolved = await resolve(query, actor);
			if (!resolved) return SIGNED_OUT as ServiceResult<{ session: CheckoutSessionContext }>;
			const { owner, items, money, view } = resolved;

			const promo = await view.resolvePromo(view.promoCode, items);
			const processingOffer = processingOfferFor(money);
			const totals = toTotals(
				items,
				promoMinorFor(promo),
				money,
				feeBpOf(owner),
				processingOffer.optedIn ? processingOffer.amount.minor : 0,
			);
			const providers = offerFor(resolved, totals.total.minor);
			const shortfall = Math.max(totals.total.minor - resolved.walletMinor, 0);
			const requirements = checkoutRequirements(items);
			const [details, spendLimit, charge] = await Promise.all([
				detailsFor(owner, query, actor),
				spendLimitFor(owner, totals.total.minor, money, actor),
				chargeFor(
					query,
					actor,
					resolved,
					items,
					() => toTotals(items, promoMinorFor(promo), money, feeBpOf(owner), 0).total,
				),
			]);

			return ok({
				session: {
					basketId: resolved.basketId,
					owner: {
						ownerType: owner.ownerType,
						ownerId: owner.ownerId,
						name: owner.name.slice(0, 120),
						handle: owner.isEntity && owner.handle ? owner.handle.slice(0, 40) : null,
						avatar: owner.avatar,
						actingIsMember: owner.actingIsMember,
					},
					currency: money.display,
					// Read off the converted prices themselves, so the rate the buyer is quoted and the
					// figures they are charged cannot come from two different tables.
					settlement: money.settlementFor(items.map((item) => item.unitPrice)),
					items,
					groups: view.groupsFor(items),
					preselect: {
						projectId: query.projectId ?? null,
						serviceId: query.serviceId ?? null,
					},
					provider: null,
					providers,
					wallet: {
						available: money.derived(resolved.walletMinor),
						shortfall: money.derived(shortfall),
						covers: shortfall === 0,
					},
					savedCards: resolved.cards,
					defaultCardId: defaultCardOf(resolved.cards, owner),
					cardsConnected: processorConnected(),
					promo,
					totals,
					charge,
					requiresEmail: requirements.requiresEmail,
					requiresSchedule: requirements.requiresSchedule,
					requiresStage: requirements.requiresStage,
					blockers: blockersFor(resolved, providers, { buyer: details.buyer, spendLimit }),
					buyer: details.buyer,
					billingContexts: details.billingContexts,
					invoicing: details.invoicing,
					processingOffer,
					spendLimit,
				},
			});
		});
	}

	/**
	 * The Details step's read: the buyer's saved record for the paying account, every identity they may
	 * bill through, and the monthly-invoicing offer — the same three values {@link session} carries.
	 */
	static details(query: BasketQuery, actor: ReadActor): Promise<ServiceResult<DetailsPayload>> {
		return guarded("details", async () => {
			const read = await readBasket(query, actor);
			if (!read.ok) return SIGNED_OUT as ServiceResult<DetailsPayload>;
			return ok(await detailsFor(read.value.owner, query, actor));
		});
	}

	/**
	 * The selectable spend departments for each billing identity the viewer may bill through, keyed by
	 * identity so the form can switch between them without a second round trip. An account that
	 * declares no departments yields an empty array — a real answer, not a missing one.
	 */
	static departments(
		query: BasketQuery,
		actor: ReadActor,
	): Promise<ServiceResult<{ departments: Record<string, readonly { id: string; label: string }[]> }>> {
		return guarded("departments", async () => {
			const owners = await listOwners(query, actor);
			if (owners.length === 0) {
				return SIGNED_OUT as ServiceResult<
					{ departments: Record<string, readonly { id: string; label: string }[]> }
				>;
			}
			return ok({
				departments: Object.fromEntries(
					owners.filter((o) => o.isMember).map((owner) => [owner.key, departmentsOf(owner)]),
				),
			});
		});
	}

	/**
	 * Save the buyer's delivery + billing details for the paying account. Returns the refreshed record
	 * AND the whole checkout session, because saving is what clears the `missing_details` blocker.
	 */
	static saveDetails(
		input: SaveBuyerDetails,
		query: BasketQuery,
		actor: ReadActor,
	): Promise<ServiceResult<DetailsPayload & { session: CheckoutSessionContext }>> {
		type Out = DetailsPayload & { session: CheckoutSessionContext };
		return guarded("save-details", async () => {
			const read = await readBasket(query, actor);
			if (!read.ok) return SIGNED_OUT as ServiceResult<Out>;
			const owner = read.value.owner;
			const saved = await saveBuyerDetails(owner, input, actor);
			if (!saved.ok) return fail(saved.status, { message: saved.message }) as ServiceResult<Out>;
			const session = await CheckoutBackendService.session(query, actor);
			if (!session.ok || !session.data) {
				// The save DID land, and a caller told otherwise would re-submit it.
				return fail(500, {
					message:
						"Your details were saved, but we couldn't refresh the checkout. Reload to continue.",
				}) as ServiceResult<Out>;
			}
			return ok({ ...(await detailsFor(owner, query, actor)), session: session.data.session }, {
				message: "Details saved.",
			});
		});
	}

	/**
	 * Charge a checkout — from the Projective wallet, the one provider that can settle here.
	 *
	 * Every check the checkout page shows is re-run against the SUBMITTED lines (a line left out of
	 * this payment must not block it), then the display total the buyer was shown is compared with a
	 * fresh computation — a client-supplied total accepted blindly is a price-tampering hole. The money
	 * then moves in ONE database transaction (`finance.place_wallet_order`), which re-prices each line
	 * against the unit price the buyer saw, re-validates the promo code, debits the wallet, credits the
	 * sellers, writes the order and consumes the lines. It is idempotent on `idempotencyKey`: a retried
	 * submit answers with the order it already placed.
	 *
	 * A CARD or EXPRESS payment answers `requires_action` with a PaymentIntent for the session's
	 * `charge` — the total in the listings' own currency: the charge tops up the paying wallet, and once
	 * the signed webhook has credited it the browser places the wallet order under the SAME attempt key,
	 * so a retried or repeated placement replays rather than ordering twice.
	 */
	static create(
		input: CreateCheckout,
		query: BasketQuery,
		actor: ReadActor,
	): Promise<ServiceResult<{ result: CheckoutResult }>> {
		type Out = { result: CheckoutResult };
		return guarded("create", async () => {
			if (!canReadLive(actor)) return SIGNED_OUT as ServiceResult<Out>;
			// A retry after a dropped response carries the key of an attempt that may already have been
			// paid — and by then its lines are consumed, so every check below would refuse it as "your
			// basket changed" while the money had moved. The key is answered FIRST.
			const prior = await placedOrderFor(input.idempotencyKey, actor.accessToken);
			if (prior) {
				const result = succeeded(prior);
				return ok({ result }, { message: result.message });
			}

			const resolved = await resolve({ ...query, basketId: input.basketId }, actor);
			if (!resolved) return SIGNED_OUT as ServiceResult<Out>;
			const { owner, money, view } = resolved;
			const refusal = (message: string, blockers: CheckoutBlocker[]): ServiceResult<Out> =>
				ok({ result: failed(message, blockers, money) }, { message });
			const blocker = (code: CheckoutBlocker["code"], message: string): CheckoutBlocker => ({
				code,
				message,
				itemId: null,
			});

			if (!ownerMatches(input, owner)) {
				return refusal("You can't pay from that account in this session. Switch to it and try again.", [
					blocker("not_authorised", "This checkout was submitted for a different account than the one you're acting as."),
				]);
			}

			const wanted = new Set(input.itemIds);
			const chosen = resolved.items.filter((item) => wanted.has(item.id));
			const eligible = chosen.filter(isCheckoutEligible);
			if (eligible.length === 0 || eligible.length !== wanted.size) {
				const blockers = blockersFor({ owner, items: chosen }, []);
				return refusal(
					blockers[0]?.message ?? "Your basket changed while you were paying — review it and try again.",
					blockers.length > 0 ? blockers : [blocker("price_changed", "Your basket changed while you were paying.")],
				);
			}

			const promo = await view.resolvePromo(view.promoCode, eligible);
			const totals = toTotals(eligible, promoMinorFor(promo), money, feeBpOf(owner), 0);
			const priced: Resolved = { ...resolved, items: eligible };
			const providers = offerFor(priced, totals.total.minor);
			const [details, spendLimit] = await Promise.all([
				detailsFor(owner, query, actor),
				spendLimitFor(owner, totals.total.minor, money, actor),
			]);
			const blocking = blockersFor(priced, providers, { buyer: details.buyer, spendLimit });
			if (blocking.length > 0) return refusal(blocking[0].message, blocking);

			// A card and the express wallets are the same charge path: a processor top-up of the paying
			// wallet, then the wallet order. Only a card can name a saved instrument. Invoice is the wallet
			// order too, after an on-account credit (PRODUCT_SPEC §Escrow, Wallets & Finance #4).
			const byProcessor = input.provider === "card" || input.provider === "express";
			const onAccount = input.provider === "invoice";
			if (input.provider !== "wallet" && !byProcessor && !onAccount) {
				const offered = providers.find((p) => p.provider === input.provider);
				const message = offered?.reason ?? PROCESSOR_REASON;
				return refusal(message, [blocker("no_provider", message)]);
			}
			const route = providers.find((p) => p.provider === input.provider);
			if (!route?.available) {
				const message = route?.reason ??
					(byProcessor ? PROCESSOR_REASON : "Your Projective wallet can't pay for this order.");
				return refusal(message, [blocker(byProcessor ? "no_provider" : "insufficient_funds", message)]);
			}

			// The display figures the buyer confirmed, re-verified against a fresh computation.
			if (input.currency.toUpperCase() !== money.display) {
				const message = `This basket is priced in ${money.display}, not ${input.currency.toUpperCase()}. Reload and try again.`;
				return refusal(message, [blocker("price_changed", message)]);
			}
			if ((input.processingContributionMinor ?? 0) > 0) {
				const message = "The optional contribution isn't available for this payment. Review the total and try again.";
				return refusal(message, [blocker("price_changed", message)]);
			}
			if (input.expectedTotalMinor !== totals.total.minor) {
				const message = `The price changed while you were paying — it's now ${totals.total.display}. Review the total and try again.`;
				return refusal(message, [blocker("price_changed", message)]);
			}
			// The code the buyer saw APPLIED — a refused code on the basket applies nothing and is not sent.
			const appliedCode = promo?.valid ? promo.code : null;
			if (normaliseCode(input.promoCode) !== normaliseCode(appliedCode)) {
				const message = "Your promo code changed while you were paying. Review the total and try again.";
				return refusal(message, [blocker("price_changed", message)]);
			}

			// The unit price each line was shown in, in the listing's OWN currency — what the database
			// compares with the catalogue before any money moves. One currency per charge.
			const units: Record<string, number> = {};
			let chargeCurrency: string | null = null;
			for (const item of eligible) {
				const currency = (item.unitPrice.origin?.currency ?? item.unitPrice.currency).toUpperCase();
				if (chargeCurrency !== null && chargeCurrency !== currency) {
					const message = "This basket mixes currencies. Pay for each currency separately.";
					return refusal(message, [blocker("price_changed", message)]);
				}
				chargeCurrency = currency;
				units[item.id] = item.unitPrice.origin?.minor ?? item.unitPrice.minor;
			}

			const rpcArgs = {
				p_basket_id: resolved.basketId,
				p_item_ids: eligible.map((item) => item.id),
				p_currency: chargeCurrency,
				p_units: units,
				p_promo_code: appliedCode,
				p_idempotency_key: input.idempotencyKey,
			};

			if (onAccount) {
				// Credited on account in the lines' OWN currency — exactly what place_wallet_order then
				// debits, computed by the same function a card charge uses — in one database transaction.
				const charge = await chargeFor(query, actor, resolved, eligible, () => totals.total);
				if (!charge) {
					const message = "This basket mixes currencies. Pay for each currency separately.";
					return refusal(message, [blocker("price_changed", message)]);
				}
				const { data, error } = await getUserClient(actor.accessToken).schema("finance").rpc(
					"place_on_account_order",
					{ ...rpcArgs, p_amount: charge.minor },
				);
				if (error) {
					const code = BLOCKER_FOR_SQLSTATE[error.code ?? ""] ?? (error.code === "22023" ? "no_provider" : undefined);
					if (!code) throw new Error(`finance.place_on_account_order failed: ${error.message}`);
					const message = isAgeRestricted(error)
						? AGE_RESTRICTED.message
						: error.message.slice(0, 200);
					return refusal(message, [blocker(code, message)]);
				}
				const result = succeeded(data as PlacedOrder);
				return ok({ result }, { message: `${result.message} It will be on the next monthly invoice.` });
			}

			if (byProcessor) {
				// The processor is charged in the lines' OWN currency — the figure the session showed as
				// `charge`, computed again here by the same function — and the order is then paid from the
				// wallet in that same currency, so the top-up and the debit are one amount.
				const charge = await chargeFor(
					query,
					actor,
					resolved,
					eligible,
					() => totals.total,
				);
				if (!charge) {
					const message = "This basket mixes currencies. Pay for each currency separately.";
					return refusal(message, [blocker("price_changed", message)]);
				}
				// The saved card the buyer chose, re-checked against the owner's OWN list (read as the
				// caller, so a card id from another account resolves to nothing). An express payment
				// names no saved card: the wallet sheet supplies the instrument.
				const cardId = input.provider === "card" ? input.cardId : null;
				const card = cardId ? priced.cards.find((c) => c.id === cardId) ?? null : null;
				if (cardId && !card) {
					const message = "That card is no longer on file. Choose another, or add a new one.";
					return refusal(message, [blocker("no_provider", message)]);
				}
				if (card?.isExpired) {
					const message = "That card has expired. Choose another, or add a new one.";
					return refusal(message, [blocker("no_provider", message)]);
				}
				if (card && owner.isEntity && !card.isBusinessCard) {
					const message = "This account can only pay with a business card. Choose another card.";
					return refusal(message, [blocker("no_provider", message)]);
				}
				const pay = await PaymentBackendService.createCheckoutCardPayment({
					ownerType: owner.ownerType,
					ownerId: owner.ownerId,
					amountMinor: charge.minor,
					currency: charge.currency,
					// Its own namespace, so the card charge and the wallet order that follows it can never
					// collide on one attempt key.
					idempotencyKey: `card-${input.idempotencyKey}`.slice(0, 120),
					savedCardRef: card?.stripePaymentMethodId ?? null,
					// Exactly what `place_wallet_order` is handed below, under the attempt's OWN key — so
					// the webhook placing it and the browser placing it are one order (Decision #153).
					checkout: {
						basketId: resolved.basketId,
						itemIds: eligible.map((item) => item.id),
						currency: charge.currency,
						units,
						promoCode: appliedCode,
						orderKey: input.idempotencyKey,
					},
				}, actor);
				if (!pay.ok || !pay.data) {
					const message = pay.message ?? PROCESSOR_REASON;
					return refusal(message, [blocker("no_provider", message)]);
				}
				const result: CheckoutResult = {
					status: "requires_action",
					orderId: null,
					charged: money.derived(0),
					nextActionUrl: null,
					message: input.provider === "express"
						? `Confirm ${charge.display} in your wallet.`
						: pay.data.confirmation === "collect"
						? `Confirm your card to pay ${charge.display}.`
						: `Charging your card ${charge.display}.`,
					blockers: [],
					walletDelta: null,
					at: new Date().toISOString(),
					payment: pay.data,
				};
				return ok({ result }, { message: result.message, status: 202 });
			}

			const { data, error } = await getUserClient(actor.accessToken).schema("finance").rpc(
				"place_wallet_order",
				{
					p_basket_id: resolved.basketId,
					p_item_ids: eligible.map((item) => item.id),
					p_currency: chargeCurrency,
					p_units: units,
					p_promo_code: appliedCode,
					p_idempotency_key: input.idempotencyKey,
				},
			);
			if (error) {
				const code = BLOCKER_FOR_SQLSTATE[error.code ?? ""];
				if (!code) throw new Error(`finance.place_wallet_order failed: ${error.message}`);
				const message = isAgeRestricted(error)
					? AGE_RESTRICTED.message
					: error.message.slice(0, 200);
				return refusal(message, [blocker(code, message)]);
			}

			const result = succeeded(data as PlacedOrder);
			return ok({ result }, { message: result.message });
		});
	}
}

// #region Charging
/**
 * The blocker a wallet-order refusal maps to, by the SQLSTATE `finance.place_wallet_order` raises —
 * so the surface explains a refusal the same way whether the app or the database caught it.
 */
const BLOCKER_FOR_SQLSTATE: Record<string, CheckoutBlocker["code"]> = {
	"42501": "not_authorised",
	PK403: "verification_required",
	PC409: "price_changed",
	PB404: "price_changed",
	PD422: "missing_email",
	PU422: "unavailable_item",
	PS501: "no_provider",
	PF402: "insufficient_funds",
	PA403: "spend_limit",
	PM403: "not_authorised",
};

/** What `finance.place_wallet_order` answers with — and what a replayed key is re-read as. */
interface PlacedOrder {
	order_id: string;
	reference: string;
	charged_minor: number;
	currency: string;
	replayed: boolean;
}

/**
 * The order an attempt key already placed, read as the caller. `null` when none — including when the
 * key belongs to an order the caller cannot see, which the payment function itself then refuses.
 */
async function placedOrderFor(key: string, accessToken: string): Promise<PlacedOrder | null> {
	const { data, error } = await getUserClient(accessToken).schema("finance").from("orders")
		.select("id, reference, charged_minor, currency")
		.eq("idempotency_key", key)
		.maybeSingle();
	if (error) throw new Error(`finance.orders replay read failed: ${error.message}`);
	if (!data) return null;
	const row = data as { id: string; reference: string; charged_minor: number | string; currency: string };
	return {
		order_id: row.id,
		reference: row.reference,
		charged_minor: Number(row.charged_minor),
		currency: row.currency,
		replayed: true,
	};
}

/**
 * A completed wallet payment. The charge is stated in the currency the wallet actually moved — the
 * listing's own — never re-converted: a receipt quotes what happened, not what it would cost today.
 */
function succeeded(placed: PlacedOrder): CheckoutResult {
	const charged: MoneyView = {
		minor: placed.charged_minor,
		currency: placed.currency,
		display: formatMoney(placed.charged_minor, placed.currency, DEFAULT_LOCALE),
		origin: null,
	};
	return {
		status: "succeeded",
		orderId: placed.order_id,
		charged,
		nextActionUrl: null,
		message: placed.replayed
			? `This payment was already made — order ${placed.reference}.`
			: `Paid ${charged.display} from your Projective wallet.`,
		blockers: [],
		walletDelta: { ...charged, minor: -charged.minor, display: `-${charged.display}` },
		at: new Date().toISOString(),
	};
}

/** A promo code compared the way the database stores it: trimmed, upper-cased, absent when blank. */
function normaliseCode(code: string | null | undefined): string | null {
	const trimmed = code?.trim().toUpperCase() ?? "";
	return trimmed.length > 0 ? trimmed : null;
}

/** Whether the submitted owner is the account this request may spend from. */
function ownerMatches(input: CreateCheckout, owner: ResolvedOwner): boolean {
	if (input.ownerId !== owner.ownerId) return false;
	if (owner.isEntity) return input.ownerType === owner.ownerType;
	return input.ownerType === "user" || input.ownerType === "freelancer";
}

/** A refusal outcome carrying its blockers. */
function failed(message: string, blockers: CheckoutBlocker[], money: MoneyProjector): CheckoutResult {
	return {
		status: "failed",
		orderId: null,
		charged: money.derived(0),
		nextActionUrl: null,
		message: message.slice(0, 200),
		blockers: blockers.slice(0, 20),
		walletDelta: null,
		at: new Date().toISOString(),
	};
}
// #endregion
