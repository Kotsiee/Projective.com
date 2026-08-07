import type { CardBrand, SaveCardInput, SavedCard } from "@projective/types/finance";
import { referenceNow, type ResolvedOwner } from "./basket-fixtures.ts";
import type { BasketCardState } from "./basket-query.ts";

/**
 * cards fixtures — the fat {@link CardsBackendService}'s deterministic wallet of saved cards while
 * `FINANCE_BACKEND_LIVE` is off.
 *
 * ⚠️ **Nothing here can express a card number.** The corpus holds an opaque `stripePaymentMethodId`
 * plus the display fragments Stripe itself returns (brand · last4 · expiry · an optional IIN), exactly
 * as `SavedCardSchema` does — there is no PAN field and no CVV field to populate, so a fixture cannot
 * leak one. On the live path the same fragments are read back from Stripe rather than accepted from a
 * client, which is why {@link SaveCardInput} carries only the token.
 *
 * The corpus deliberately covers every branch a consumer must survive: a card WITH a `binNumber` and
 * cards without (Stripe returns an IIN only under an explicit entitlement, so `binNumber` is usually
 * `null` and every consumer must degrade to `brand` — which is what `resolveCardArt` does), an
 * **expired** card, a **wallet-wrapped** instrument with no last4 or expiry at all, and business cards
 * on each entity scope. `isExpired` is derived against the SERVER clock: a client clock must not decide
 * a card is dead.
 */

// #region Seeds
/** A seeded card. `ownerKey` is the basket fixtures' scope key, so cards and baskets share one cast. */
interface CardSeed {
	id: string;
	ownerKey: string;
	stripePaymentMethodId: string;
	brand: CardBrand;
	last4: string | null;
	expMonth: number | null;
	expYear: number | null;
	cardholderName: string | null;
	/** The 6–8 issuer-identification digits, when the account is entitled to them; usually `null`. */
	binNumber: string | null;
	isBusinessCard: boolean;
	isDefault: boolean;
	createdByUserId: string | null;
	/** Days behind the reference clock the card was attached. */
	addedDaysAgo: number;
	/** The `finance.payment_methods` row this card is registered as, once promoted. */
	paymentMethodId: string | null;
}

const SEEDS: CardSeed[] = [
	{
		id: "cd-personal-visa",
		ownerKey: "personal",
		stripePaymentMethodId: "pm_XXXX-XXXX-personal-visa",
		brand: "visa",
		last4: "4242",
		expMonth: 11,
		expYear: 2029,
		cardholderName: "Ahmed K.",
		binNumber: "424242",
		isBusinessCard: false,
		isDefault: true,
		createdByUserId: "u-ahmed",
		addedDaysAgo: 240,
		paymentMethodId: "pmr-personal-visa",
	},
	{
		id: "cd-personal-mastercard",
		ownerKey: "personal",
		stripePaymentMethodId: "pm_XXXX-XXXX-personal-mc",
		brand: "mastercard",
		last4: "4444",
		expMonth: 4,
		expYear: 2028,
		cardholderName: "Ahmed K.",
		// No IIN entitlement on this one — the brand-degradation path.
		binNumber: null,
		isBusinessCard: false,
		isDefault: false,
		createdByUserId: "u-ahmed",
		addedDaysAgo: 120,
		paymentMethodId: null,
	},
	{
		id: "cd-personal-amex-expired",
		ownerKey: "personal",
		stripePaymentMethodId: "pm_XXXX-XXXX-personal-amex",
		brand: "amex",
		last4: "0005",
		expMonth: 3,
		expYear: 2026,
		cardholderName: "Ahmed K.",
		binNumber: "371449",
		isBusinessCard: false,
		isDefault: false,
		createdByUserId: "u-ahmed",
		addedDaysAgo: 700,
		paymentMethodId: null,
	},
	{
		id: "cd-personal-applepay",
		ownerKey: "personal",
		stripePaymentMethodId: "pm_XXXX-XXXX-personal-apple",
		brand: "apple_pay",
		// A wallet-wrapped instrument carries no display fragments of its own.
		last4: null,
		expMonth: null,
		expYear: null,
		cardholderName: null,
		binNumber: null,
		isBusinessCard: false,
		isDefault: false,
		createdByUserId: "u-ahmed",
		addedDaysAgo: 40,
		paymentMethodId: null,
	},
	{
		id: "cd-northwind-visa",
		ownerKey: "team:northwind",
		stripePaymentMethodId: "pm_XXXX-XXXX-northwind-visa",
		brand: "visa",
		last4: "1881",
		expMonth: 7,
		expYear: 2028,
		cardholderName: "Northwind Studio Ltd",
		binNumber: null,
		isBusinessCard: true,
		isDefault: true,
		createdByUserId: "u-tomas",
		addedDaysAgo: 300,
		paymentMethodId: "pmr-northwind-visa",
	},
	{
		id: "cd-monarch-mastercard",
		ownerKey: "business:monarch-labs",
		stripePaymentMethodId: "pm_XXXX-XXXX-monarch-mc",
		brand: "mastercard",
		last4: "5100",
		expMonth: 9,
		expYear: 2030,
		cardholderName: "Monarch Labs Ltd",
		binNumber: "51000000",
		isBusinessCard: true,
		isDefault: true,
		createdByUserId: "u-ahmed",
		addedDaysAgo: 410,
		paymentMethodId: "pmr-monarch-mc",
	},
	{
		id: "cd-monarch-amex",
		ownerKey: "business:monarch-labs",
		stripePaymentMethodId: "pm_XXXX-XXXX-monarch-amex",
		brand: "amex",
		last4: "8431",
		expMonth: 1,
		expYear: 2031,
		cardholderName: "Monarch Labs Ltd",
		binNumber: null,
		isBusinessCard: true,
		isDefault: false,
		createdByUserId: "u-lena",
		addedDaysAgo: 90,
		paymentMethodId: null,
	},
	{
		id: "cd-meridian-visa",
		ownerKey: "organisation:meridian",
		stripePaymentMethodId: "pm_XXXX-XXXX-meridian-visa",
		brand: "visa",
		last4: "9310",
		expMonth: 6,
		expYear: 2029,
		cardholderName: "Meridian Group",
		binNumber: null,
		isBusinessCard: true,
		isDefault: true,
		createdByUserId: "u-ahmed",
		addedDaysAgo: 150,
		paymentMethodId: "pmr-meridian-visa",
	},
];
// #endregion

// #region Mutable session store
const DAY = 86_400_000;
const STATE = new Map<string, CardSeed[]>();
let seq = 0;

/** Lazily seed (and return) the mutable card list for an owner scope. */
function cardsFor(ownerKey: string): CardSeed[] {
	const existing = STATE.get(ownerKey);
	if (existing) return existing;
	const seeded = SEEDS.filter((c) => c.ownerKey === ownerKey).map((c) => ({ ...c }));
	STATE.set(ownerKey, seeded);
	return seeded;
}

/**
 * Whether a card has passed its expiry, against the SERVER clock. A card is good through the LAST day
 * of its expiry month, so the comparison is against the first instant of the following month.
 */
function expired(seed: CardSeed, now: number): boolean {
	if (seed.expMonth === null || seed.expYear === null) return false;
	return now >= Date.UTC(seed.expYear, seed.expMonth, 1);
}

/** Project a seed into the SSOT's {@link SavedCard}. */
function toCard(seed: CardSeed, owner: ResolvedOwner, now: number): SavedCard {
	return {
		id: seed.id,
		ownerType: owner.ownerType,
		ownerId: owner.ownerId,
		paymentMethodId: seed.paymentMethodId,
		stripePaymentMethodId: seed.stripePaymentMethodId,
		brand: seed.brand,
		last4: seed.last4,
		expMonth: seed.expMonth,
		expYear: seed.expYear,
		cardholderName: seed.cardholderName,
		binNumber: seed.binNumber,
		isBusinessCard: seed.isBusinessCard,
		isDefault: seed.isDefault,
		createdByUserId: seed.createdByUserId,
		createdAt: new Date(now - seed.addedDaysAgo * DAY).toISOString(),
		isExpired: expired(seed, now),
	};
}
// #endregion

// #region Reads
/**
 * Apply the simulated saved-card axis to a resolved list.
 *
 * `expired` marks every card expired rather than filtering to the one seed that happens to be — only
 * the personal scope carries an expired card, so a filter would silently hand an entity an EMPTY
 * wallet and label it "expired", which is a different state with a different remedy. Marking preserves
 * "cards on file, none of them chargeable", which is the state the axis exists to reach.
 */
function applyCardSim(cards: SavedCard[], sim: BasketCardState | undefined): SavedCard[] {
	if (sim === "none") return [];
	if (sim === "expired") return cards.map((card) => ({ ...card, isExpired: true }));
	return cards;
}

/** Every card on file for the resolved owner — default first, then newest. */
export function listCards(owner: ResolvedOwner, sim?: BasketCardState): SavedCard[] {
	const now = referenceNow();
	const cards = cardsFor(owner.key)
		.map((seed) => toCard(seed, owner, now))
		.sort((a, b) =>
			Number(b.isDefault) - Number(a.isDefault) || b.createdAt.localeCompare(a.createdAt)
		);
	return applyCardSim(cards, sim);
}

/**
 * The card a card payment pre-selects: the owner's default when it is usable, else the first usable
 * one. An entity may only pay with a business card, so a personal card is never offered there.
 */
export function defaultCardId(owner: ResolvedOwner, sim?: BasketCardState): string | null {
	const usable = listCards(owner, sim).filter((c) =>
		!c.isExpired && (!owner.isEntity || c.isBusinessCard)
	);
	return usable.find((c) => c.isDefault)?.id ?? usable[0]?.id ?? null;
}

/** Look one card up within the owner's scope. */
export function findCard(
	owner: ResolvedOwner,
	cardId: string,
	sim?: BasketCardState,
): SavedCard | undefined {
	return listCards(owner, sim).find((c) => c.id === cardId);
}
// #endregion

// #region Writes
/** The outcome of a card write: the refreshed list, or a refusal with a status + message. */
export interface CardOutcome {
	ok: boolean;
	status?: number;
	message: string;
	cards?: SavedCard[];
	card?: SavedCard;
}

/** The brands a stub attachment can resolve to — the four real networks, cycled deterministically. */
const STUB_BRANDS: CardBrand[] = ["visa", "mastercard", "amex", "discover"];

/** A stable non-negative hash (unsigned `>>>`, per the documented hash-index gotcha). */
function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h;
}

/**
 * Register a tokenised card.
 *
 * The display fragments are **derived from the token**, never accepted from the caller: on the live
 * path they are read back from Stripe, and letting a client supply them would let it mislabel a card.
 * A `binNumber` is deliberately NOT minted — the stub reproduces the common case where no IIN
 * entitlement exists, so every consumer exercises the brand-degradation path.
 */
export function saveCard(input: SaveCardInput, owner: ResolvedOwner): CardOutcome {
	if (owner.isEntity && !owner.actingIsMember) {
		return {
			ok: false,
			status: 403,
			message: "Only a member of this account can add a card to it.",
		};
	}
	if (input.isBusinessCard && !owner.isEntity) {
		return {
			ok: false,
			status: 422,
			message:
				"A business card belongs to a team, business or organisation. Switch to that account to add it.",
		};
	}

	const list = cardsFor(owner.key);
	const existing = list.find((c) => c.stripePaymentMethodId === input.stripePaymentMethodId);
	if (existing) {
		return {
			ok: false,
			status: 409,
			message: "That card is already on file for this account.",
		};
	}

	const h = hash(input.stripePaymentMethodId);
	const now = referenceNow();
	const seed: CardSeed = {
		id: `cd-${owner.key.replace(/[^a-z0-9]+/g, "-")}-${++seq}`,
		ownerKey: owner.key,
		stripePaymentMethodId: input.stripePaymentMethodId,
		brand: STUB_BRANDS[h % STUB_BRANDS.length],
		last4: String(h % 10_000).padStart(4, "0"),
		expMonth: (h % 12) + 1,
		expYear: 2029 + (h % 4),
		cardholderName: input.cardholderName,
		binNumber: null,
		isBusinessCard: input.isBusinessCard,
		isDefault: input.setDefault || list.length === 0,
		createdByUserId: owner.key === "personal" ? owner.ownerId : null,
		addedDaysAgo: 0,
		paymentMethodId: null,
	};
	if (seed.isDefault) { for (const card of list) card.isDefault = false; }
	list.push(seed);
	return {
		ok: true,
		message: `Card ending ${seed.last4} added.`,
		card: toCard(seed, owner, now),
		cards: listCards(owner),
	};
}

/** Make one card the owner's default. An expired card is refused rather than silently accepted. */
export function setDefaultCard(cardId: string, owner: ResolvedOwner): CardOutcome {
	if (owner.isEntity && !owner.actingIsMember) {
		return {
			ok: false,
			status: 403,
			message: "Only a member of this account can change its cards.",
		};
	}
	const list = cardsFor(owner.key);
	const target = list.find((c) => c.id === cardId);
	if (!target) return { ok: false, status: 404, message: "That card is no longer on file." };
	if (expired(target, referenceNow())) {
		return { ok: false, status: 422, message: "That card has expired — replace it first." };
	}
	for (const card of list) card.isDefault = card.id === cardId;
	return {
		ok: true,
		message: "Default card updated.",
		card: toCard(target, owner, referenceNow()),
		cards: listCards(owner),
	};
}

/**
 * Detach a card. Removing the default promotes the next usable card, so an account is never left with
 * cards on file and none selected.
 */
export function removeCard(cardId: string, owner: ResolvedOwner): CardOutcome {
	if (owner.isEntity && !owner.actingIsMember) {
		return {
			ok: false,
			status: 403,
			message: "Only a member of this account can change its cards.",
		};
	}
	const list = cardsFor(owner.key);
	const index = list.findIndex((c) => c.id === cardId);
	if (index === -1) return { ok: false, status: 404, message: "That card is no longer on file." };
	const [removed] = list.splice(index, 1);
	if (removed.isDefault) {
		const next = list.find((c) => !expired(c, referenceNow()));
		if (next) next.isDefault = true;
	}
	return {
		ok: true,
		message: removed.last4 ? `Card ending ${removed.last4} removed.` : "Payment method removed.",
		cards: listCards(owner),
	};
}
// #endregion
