import { destinationEmail, isCheckoutEligible, itemKindMeta } from "@projective/types/finance";
import type { IconName } from "@projective/ui/icons";
import type {
	BasketItem,
	CheckoutBlocker,
	CheckoutSessionContext,
	CheckoutTotals,
	MoneyView,
	PaymentProvider,
	PurchasableItemGroup,
} from "../types/checkout-types.ts";

/**
 * checkout-model — the pure vocabulary and derivations the `/checkout` body renders through.
 *
 * No state, no DOM, no fetch, and — the rule this module exists to keep provable — **no money
 * arithmetic**. Every figure the surface shows arrives as a server-computed `MoneyView` and is
 * rendered by its `display` string; nothing here sums, discounts, converts or formats one. The single
 * numeric derivation in the file is {@link feeRateLabel}, which turns the SSOT's `platformFeeBp` into
 * a percentage LABEL — a rate, not an amount, and the reason `CheckoutTotals` carries the basis points
 * beside the money in the first place.
 *
 * Companion to `basket-model.ts`: that module owns the URL ⇄ context mapping and the one deep-link
 * resolver; this one owns what a checkout LINE means and what still stands between the buyer and a
 * completed payment.
 */

// #region Payment-route vocabulary
/** The human name of each payment route. The enum's own vocabulary, never re-invented per surface. */
export const PROVIDER_LABEL: Record<PaymentProvider, string> = {
	card: "Card",
	wallet: "Projective wallet",
	google_pay: "Google Pay",
	apple_pay: "Apple Pay",
	paypal: "PayPal",
	invoice: "Invoice",
};

/*
 * `PROVIDER_NOTE` — a one-line explanation per route — is gone with the six-row radio list it
 * captioned. The two regions that replaced it need no such line: an instrument the buyer already owns
 * is named by its own plate, and an express button says what it does by being the vendor's button.
 * A refused route still carries the SERVER's own reason, which is the sentence that actually matters.
 */

/**
 * The two routes a buyer SELECTS between, as opposed to the ones they trigger.
 *
 * The payment step draws one list of instruments — the Projective wallet and the cards on file — and
 * a buyer picks the THING they want to pay with; the route is a consequence of that choice rather
 * than a question asked before it. The remaining three live routes (Google Pay, Apple Pay, PayPal)
 * are **express** actions: pressing one starts a payment immediately in the vendor's own sheet, so
 * they are never a selection that sits waiting for a separate Buy Now. `invoice` is not a route the
 * buyer picks here at all — consolidated monthly billing is arranged once, on the Details step, and
 * offering it as a per-purchase instrument would imply it can be chosen per basket.
 */
export const SELECTABLE_ROUTES: readonly PaymentProvider[] = ["wallet", "card"];

/** Whether a route is one the instrument list can hold a selection for. */
export function isSelectableRoute(provider: PaymentProvider | null): boolean {
	return provider !== null && SELECTABLE_ROUTES.includes(provider);
}

/**
 * The id of one selectable instrument — the single value the wallet and every saved card compete
 * for.
 *
 * The wallet and the card list are two presentations of ONE decision, so they must not be able to
 * hold two answers. `(provider, cardId)` remains the storage, because that pair is what the charge
 * payload and the route gates are expressed in; this is the projection of it that the UI selects on,
 * which is what makes "either the wallet or a card, never both" true by construction rather than by
 * two components remembering to clear each other.
 */
export type PaymentMethodId = "wallet" | `card:${string}`;

/** The instrument currently selected, or `null` when the pair does not name one. */
export function methodIdOf(
	provider: PaymentProvider | null,
	cardId: string | null,
): PaymentMethodId | null {
	if (provider === "wallet") return "wallet";
	if (provider === "card" && cardId) return `card:${cardId}`;
	return null;
}

/** The `(provider, cardId)` pair an instrument id resolves to. */
export function routeOfMethod(id: PaymentMethodId): {
	provider: PaymentProvider;
	cardId: string | null;
} {
	return id === "wallet"
		? { provider: "wallet", cardId: null }
		: { provider: "card", cardId: id.slice("card:".length) };
}

/** The registry glyph a payment route is marked with. */
export function providerIcon(provider: PaymentProvider): IconName {
	switch (provider) {
		case "wallet":
			return "wallet";
		case "invoice":
			return "document";
		case "paypal":
			return "globe";
		case "google_pay":
		case "apple_pay":
			return "shield";
		case "card":
		default:
			return "catalogue";
	}
}
// #endregion

// #region Line grouping
/**
 * One rendered block of the checkout's "paying for" column.
 *
 * Built from the server's own {@link CheckoutSessionContext.groups}, which carry ids rather than
 * nested rows — so a group can never disagree with the line it points at — plus a trailing bucket for
 * any line the server did not group. The bucket is defensive rather than expected: a projection that
 * grew a kind the grouper had not learned would otherwise drop lines the buyer is about to pay for.
 */
export interface CheckoutSection {
	key: string;
	label: string;
	caption: string | null;
	group: PurchasableItemGroup;
	/** Deep link to the project/service this block is anchored to; `null` for a loose category. */
	href: string | null;
	items: BasketItem[];
	/** The server's subtotal for the block; `null` for the ungrouped bucket, which has none. */
	subtotal: MoneyView | null;
}

/** Resolve a session's lines into the server's blocks, preserving server order. */
export function sectionsOf(session: CheckoutSessionContext): CheckoutSection[] {
	const byId = new Map(session.items.map((item) => [item.id, item]));
	const claimed = new Set<string>();
	const sections: CheckoutSection[] = [];

	for (const group of session.groups) {
		const items: BasketItem[] = [];
		for (const id of group.itemIds) {
			const item = byId.get(id);
			if (!item) continue;
			claimed.add(id);
			items.push(item);
		}
		if (items.length === 0) continue;
		sections.push({
			key: group.id,
			label: group.label,
			caption: group.caption,
			group: group.group,
			href: group.href,
			items,
			subtotal: group.subtotal,
		});
	}

	const loose = session.items.filter((item) => !claimed.has(item.id));
	if (loose.length > 0) {
		sections.push({
			key: "cko-ungrouped",
			label: "Also in this payment",
			caption: null,
			group: itemKindMeta(loose[0].itemType).group,
			href: null,
			items: loose,
			subtotal: null,
		});
	}
	return sections;
}

/** Whether a block contains stage-routed lines — the block that renders as a stage ladder. */
export function isStageLadder(section: CheckoutSection): boolean {
	return section.items.some((item) => itemKindMeta(item.itemType).needsStage);
}

/** How many of a block's stage lines are in this payment, and how many there are. Counts, not money. */
export function stageTally(
	section: CheckoutSection,
	selected: (item: BasketItem) => boolean,
): { now: number; total: number } {
	const stages = section.items.filter((item) => itemKindMeta(item.itemType).needsStage);
	return { now: stages.filter(selected).length, total: stages.length };
}
// #endregion

// #region Scheduling & timezone confirmation
/**
 * The identity of the slot a buyer confirmed.
 *
 * Keyed on the line AND the instant, so re-scheduling a booking re-arms the confirmation instead of
 * carrying forward an acknowledgement of a time that no longer applies — which is the failure mode
 * that makes a confirmation worthless.
 */
export function slotKey(item: BasketItem): string {
	return `${item.id}@${item.scheduledAt ?? "unset"}`;
}

/** Whether a line is a booking the buyer must acknowledge the time of before paying. */
export function needsSlotConfirmation(item: BasketItem): boolean {
	return itemKindMeta(item.itemType).needsSchedule && item.scheduledAt !== null;
}

/** The viewer's own IANA timezone, or `null` where the platform cannot resolve one. */
export function viewerZone(): string | null {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
	} catch {
		return null;
	}
}

/**
 * The same instant the seller's slot names, rendered in the VIEWER's zone and locale.
 *
 * This is the fact the acknowledgement is actually about: "14:00 Europe/London" is unambiguous only
 * to someone already in Europe/London. Client-only by construction — a server render would resolve
 * the SERVER's zone and state a time nobody is in.
 */
export function localSlotLabel(iso: string, zone: string): string | null {
	try {
		const at = new Date(iso);
		if (Number.isNaN(at.getTime())) return null;
		return new Intl.DateTimeFormat(undefined, {
			timeZone: zone,
			weekday: "short",
			day: "numeric",
			month: "short",
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		}).format(at);
	} catch {
		return null;
	}
}

/** The short zone name for an instant ("BST", "GMT+1"), or `null` when the zone will not resolve. */
export function zoneAbbr(iso: string, zone: string): string | null {
	try {
		const at = new Date(iso);
		if (Number.isNaN(at.getTime())) return null;
		const part = new Intl.DateTimeFormat(undefined, { timeZone: zone, timeZoneName: "short" })
			.formatToParts(at).find((p) => p.type === "timeZoneName");
		return part?.value ?? null;
	} catch {
		return null;
	}
}

/** Whether two IANA zone names describe the same zone, tolerating a null on either side. */
export function sameZone(a: string | null, b: string | null): boolean {
	return a !== null && b !== null && a === b;
}
// #endregion

// #region Delivery address
/**
 * Whether a typed address satisfies the SSOT's own `destinationEmail` rule.
 *
 * Delegates to the schema rather than mirroring its regex: a second copy of a validity rule is how a
 * client comes to accept an address the server then refuses, on the one field whose failure means a
 * paid-for download goes nowhere.
 */
export function emailValid(value: string): boolean {
	return destinationEmail.safeParse(value).success;
}

/**
 * Addresses already present on OTHER lines of this checkout, offered as one-click reuse.
 *
 * Deliberately not an address book: the projection carries no such list, and inventing one would put
 * addresses on screen that the buyer never gave this surface. Everything offered here is already
 * visible somewhere else on the same page.
 */
export function suggestedEmails(items: readonly BasketItem[], exceptId: string): string[] {
	const seen = new Set<string>();
	for (const item of items) {
		if (item.id === exceptId) continue;
		const value = item.destinationEmail;
		if (value && emailValid(value)) seen.add(value);
	}
	return [...seen];
}
// #endregion

// #region Client-owned gates
/**
 * The blockers the CLIENT owns, as distinct from the ones the server sends.
 *
 * There is exactly one, and it is a real gate rather than a courtesy: a booking's time can only be
 * *acknowledged* on the device the buyer is reading it on, so the server cannot know whether it has
 * been. It is minted with the SSOT's `missing_schedule` code because that is what it is from the
 * checkout's point of view — the slot is not settled — even though the server reserves that code for
 * a line with no slot at all. Both mean "this booking's time is not agreed yet".
 *
 * Only lines that are actually being paid for can gate a payment; a booking the buyer left out of
 * this checkout must not block the lines they did select.
 */
export function clientGatesFor(
	items: readonly BasketItem[],
	isIncluded: (item: BasketItem) => boolean,
	confirmed: Readonly<Record<string, boolean>>,
): CheckoutBlocker[] {
	const gates: CheckoutBlocker[] = [];
	for (const item of items) {
		if (!item.available || item.savedForLater || !isIncluded(item)) continue;
		if (!needsSlotConfirmation(item)) continue;
		if (confirmed[slotKey(item)] === true) continue;
		gates.push({
			code: "missing_schedule",
			message: `Confirm the time for “${item.title}” before paying — bookings are made in the ` +
				`seller's timezone.`,
			itemId: item.id,
		});
	}
	return gates;
}

/** Whether a line is being paid for right now — the SSOT's own predicate, with the optimistic overlay. */
export function includedNow(item: BasketItem, selected: boolean): boolean {
	return isCheckoutEligible({ ...item, isSelectedForCheckout: selected });
}

/**
 * Gates on the chosen ROUTE, as opposed to the lines.
 *
 * The server raises `no_provider` only when NOT ONE route is available, which leaves a real gap: a
 * buyer who picked the wallet before a price rise, or a card that has since been removed, still holds
 * a selection the server will refuse at charge time. Left alone, that is a live Pay button leading to
 * a guaranteed failure — the exact shape the blocker list exists to prevent — so the surface names it
 * before the charge instead of after.
 *
 * The refusal sentence is the server's own from the provider offer, never a second wording of it.
 */
export function routeGatesFor(
	session: CheckoutSessionContext,
	provider: PaymentProvider | null,
	cardId: string | null,
): CheckoutBlocker[] {
	// Nothing to say about a route while there is nothing to pay for; the `empty` blocker owns that.
	if (session.providers.length === 0) return [];
	// When NOT ONE route is open the server already says so with `no_provider`. Telling the buyer to
	// choose a method they have none of would be a second, less useful wording of the same refusal.
	if (!session.providers.some((entry) => entry.available)) return [];

	if (provider === null) {
		return [{
			code: "no_provider",
			message: "Choose how you'd like to pay.",
			itemId: null,
		}];
	}

	const offer = session.providers.find((entry) => entry.provider === provider);
	if (!offer || !offer.available) {
		return [{
			code: "no_provider",
			message: offer?.reason ??
				`${PROVIDER_LABEL[provider]} isn't available for this account. Choose another method.`,
			itemId: null,
		}];
	}

	if (provider === "card") {
		if (!cardId) {
			return [{ code: "no_provider", message: "Choose a card to pay with.", itemId: null }];
		}
		const card = session.savedCards.find((entry) => entry.id === cardId);
		if (!card) {
			return [{
				code: "no_provider",
				message: "That card is no longer on file. Choose another one.",
				itemId: null,
			}];
		}
		if (card.isExpired) {
			return [{
				code: "no_provider",
				message: "That card has expired. Choose another one or add a new card.",
				itemId: null,
			}];
		}
	}

	return [];
}
// #endregion

// #region Fee disclosure
/** How the platform fee must be PRESENTED, which differs by who actually bears it. */
export interface FeeDisclosure {
	label: string;
	/** The sentence that keeps the figure honest; always rendered beside the amount. */
	note: string;
	/** Whether this amount is part of what the buyer pays. */
	charged: boolean;
}

/**
 * The percentage label for a basis-point rate: `500` → `"5%"`, `250` → `"2.5%"`.
 *
 * A rate, not an amount — the one number this module derives, and the reason
 * {@link CheckoutTotals.platformFeeBp} travels beside the money at all.
 */
export function feeRateLabel(bp: number): string {
	const pct = bp / 100;
	return `${Number.isInteger(pct) ? pct : Number(pct.toFixed(2))}%`;
}

/**
 * Present the platform fee according to `platformFeeMode`.
 *
 * Under the platform's documented default, `seller_deducted`, the fee comes out of the seller's
 * release and is **not added to the buyer's total** — so it is disclosure, not a line the buyer pays,
 * and rendering it as an addition would misstate the price by the fee. Under `buyer_added` it is
 * genuinely part of the total and is labelled as such. Getting this backwards is the single most
 * expensive mistake this surface can make, which is why the branch lives in one function.
 */
export function feeDisclosure(totals: CheckoutTotals): FeeDisclosure {
	const rate = feeRateLabel(totals.platformFeeBp);
	return totals.platformFeeMode === "buyer_added"
		? {
			label: `Platform service fee (${rate})`,
			note: "Included in the total below.",
			charged: true,
		}
		: {
			label: `Platform service fee (${rate})`,
			note: "Paid by the seller out of their earnings. It is not added to your total.",
			charged: false,
		};
}
// #endregion

// #region Attempt identity
/**
 * A stable fingerprint of WHAT IS BEING BOUGHT and HOW.
 *
 * The idempotency key must survive a retry of the same attempt — that is the whole point — and must
 * NOT survive a change to the purchase, or a second, genuinely different payment would replay the
 * first one's stored outcome. Comparing this string is how the surface tells those two apart.
 *
 * The total is included because a price that moved is a different purchase even when the basket did
 * not change.
 */
export function attemptFingerprint(
	session: CheckoutSessionContext,
	provider: PaymentProvider | null,
	cardId: string | null,
	isIncluded: (item: BasketItem) => boolean,
): string {
	const lines = session.items
		.filter((item) => includedNow(item, isIncluded(item)))
		.map((item) => item.id)
		.sort()
		.join(",");
	return [
		session.basketId,
		session.owner.ownerType,
		session.owner.ownerId,
		lines,
		provider ?? "-",
		cardId ?? "-",
		session.promo?.valid ? session.promo.code : "-",
		session.currency,
		String(session.totals.total.minor),
	].join("|");
}
// #endregion

// #region Result vocabulary
/** The heading a terminal checkout outcome is announced under. */
export function resultTitle(status: CheckoutSessionOutcome): string {
	switch (status) {
		case "succeeded":
			return "Payment complete";
		case "requires_action":
			return "One more step";
		case "pending":
			return "Payment recorded";
		case "failed":
		default:
			return "Payment not taken";
	}
}

/** The registry glyph for a terminal outcome. */
export function resultIcon(status: CheckoutSessionOutcome): IconName {
	switch (status) {
		case "succeeded":
			return "success";
		case "requires_action":
			return "external-link";
		case "pending":
			return "hourglass";
		case "failed":
		default:
			return "error";
	}
}

/** The four terminal states a charge can land in. */
export type CheckoutSessionOutcome = "succeeded" | "requires_action" | "pending" | "failed";
// #endregion
