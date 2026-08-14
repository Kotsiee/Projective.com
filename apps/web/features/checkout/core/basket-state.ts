import { computed, signal } from "@preact/signals";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";
import type {
	AppliedPromo,
	Basket,
	BasketItem,
	BasketSim,
	BasketSummary,
	CheckoutContext,
	CheckoutResult,
	CheckoutSessionContext,
	PaymentProvider,
	SavedCard,
} from "../types/checkout-types.ts";
import type { CheckoutResponse } from "../types/results.ts";
import {
	isSelectableRoute,
	methodIdOf,
	type PaymentMethodId,
	routeOfMethod,
} from "./checkout-model.ts";

/**
 * basket-state — the cross-island signal store for the `/basket` + `/checkout` surfaces.
 *
 * The region contract puts four things in four separate hydration roots — the LANE (which basket), the
 * HEADER band (identity, search, currency), the FOOTER band (every action), and the BODY (the lines) —
 * so they cannot pass props to one another and must share module-level signals. That is the documented
 * pattern (`inbox-state` · `board-state` · `wallet-state`), and it is what makes "select three lines in
 * the body, press Pay in the footer" possible at all.
 *
 * **Nothing here does money arithmetic.** Every figure the surface shows is a server-computed
 * `MoneyView` rendered by its `display` string; the optimistic layer below deliberately covers only
 * NON-monetary state (which lines are selected, which are parked, which have a write in flight),
 * because an optimistically re-totalled basket would state a price the server never agreed to.
 */

// #region Shared read context (basket · owner · display currency · dev simulation)
/** The basket currently open; `null` resolves the acting account's default. */
export const activeBasketId = signal<string | null>(null);
/** The acting owner scope (`personal` · `team:northwind` · …). */
export const activeOwner = signal<string>("personal");
/** The viewer's display currency — every figure is formatted server-side in this. */
export const displayCurrency = signal<string>("GBP");
/** The live dev-simulation knobs, mirrored from the seam; `undefined` in production and when inert. */
export const devSim = signal<BasketSim | undefined>(undefined);
/** The `?project_id=` narrowing a checkout was opened with. */
export const preselectProjectId = signal<string | null>(null);
/** The `?service_id=` narrowing a checkout was opened with. */
export const preselectServiceId = signal<string | null>(null);

/** Build the {@link CheckoutContext} every service call threads, from the current signals. */
export function currentCheckoutContext(): CheckoutContext {
	return {
		basketId: activeBasketId.value,
		owner: activeOwner.value,
		display: displayCurrency.value,
		projectId: preselectProjectId.value,
		serviceId: preselectServiceId.value,
		sim: devSim.value,
	};
}

/**
 * Seed the shared context from SSR props. Called once per surface mount, BEFORE any refetch, so the
 * island's first request asks for exactly the scope the server already painted.
 */
export function seedCheckoutContext(seed: {
	basketId: string | null;
	owner: string;
	display: string;
	projectId?: string | null;
	serviceId?: string | null;
}): void {
	activeBasketId.value = seed.basketId;
	activeOwner.value = seed.owner;
	displayCurrency.value = seed.display;
	preselectProjectId.value = seed.projectId ?? null;
	preselectServiceId.value = seed.serviceId ?? null;
	if (seed.basketId) writeStored("local", LocalKeys.BASKET_LAST, seed.basketId);
}

/** The basket the reader last had open, restored after hydration (never during SSR). */
export function rememberedBasketId(): string | null {
	return readStored("local", LocalKeys.BASKET_LAST);
}
// #endregion

// #region Server projections (the only writers are `applyBasket` / `applySession` / `applyCards`)
/** The resolved basket. `null` until the first read lands. */
export const basket = signal<Basket | null>(null);
/** Every basket the acting account keeps — the lane's switcher. */
export const baskets = signal<readonly BasketSummary[]>([]);
/** The promo attached to the open basket, valid or refused. */
export const promo = signal<AppliedPromo | null>(null);
/** The whole checkout projection — owner, lines, providers, wallet, totals, blockers. */
export const session = signal<CheckoutSessionContext | null>(null);
/** The acting account's saved cards. */
export const cards = signal<readonly SavedCard[]>([]);
/** The card a card payment pre-selects; `null` when none is usable. */
export const defaultCardId = signal<string | null>(null);

/** The lines of the open basket that are not parked, in server order. */
export const activeLines = computed<readonly BasketItem[]>(() =>
	(basket.value?.items ?? []).filter((item) => !item.savedForLater)
);

/** The parked shelf. */
export const savedLines = computed<readonly BasketItem[]>(() =>
	(basket.value?.items ?? []).filter((item) => item.savedForLater)
);

/**
 * How many lines the basket holds — the count the header band and the global rail dot read.
 *
 * Deliberately the SERVER's `itemCount` rather than `items.length`: the server excludes removed and
 * already-purchased rows, and a count that disagreed with the list under it would be the surface's
 * least forgivable error.
 */
export const basketCount = computed<number>(() => basket.value?.itemCount ?? 0);
// #endregion

// #region Optimistic layer (NON-monetary state only)
/** Line ids with a write in flight — drives per-row busy state and blocks a double submit. */
export const pendingLines = signal<ReadonlySet<string>>(new Set());

/**
 * Selection the client has applied but the server has not yet confirmed, keyed by line id.
 *
 * Only the CHECKBOX moves optimistically. The basket's totals do not, because a total is a server
 * figure and an optimistic one would be a number the buyer could act on that nobody has agreed to.
 * Cleared line-by-line as each server answer lands.
 */
export const optimisticSelection = signal<Readonly<Record<string, boolean>>>({});

/** Whether a line reads as selected right now — the optimistic overlay, else the server's answer. */
export function isSelected(item: BasketItem): boolean {
	const overlay = optimisticSelection.value[item.id];
	return overlay ?? item.isSelectedForCheckout;
}

/** Mark a line as having a write in flight. */
export function beginLineWrite(lineId: string, selection?: boolean): void {
	const next = new Set(pendingLines.value);
	next.add(lineId);
	pendingLines.value = next;
	if (selection !== undefined) {
		optimisticSelection.value = { ...optimisticSelection.value, [lineId]: selection };
	}
}

/** Clear a line's in-flight marker and drop any optimistic overlay it was carrying. */
export function endLineWrite(lineId: string): void {
	const next = new Set(pendingLines.value);
	next.delete(lineId);
	pendingLines.value = next;
	if (lineId in optimisticSelection.value) {
		const { [lineId]: _dropped, ...rest } = optimisticSelection.value;
		optimisticSelection.value = rest;
	}
}
// #endregion

// #region Read/write unwrapping (the ONE place a response is opened)
/**
 * The message from the most recent FAILED read or write, or `null`.
 *
 * `/wallet` shipped ten call sites written `if (res.ok && res.data) { … }` with no else, so a failed
 * refresh left the previous account's figures on screen indefinitely. On a basket the same silence is
 * worse: a removal that did not land looks exactly like one that did until the buyer pays for it.
 */
export const checkoutError = signal<string | null>(null);

/** The most recent SERVER success sentence ("Removed from your basket."), or `null`. */
export const checkoutNotice = signal<string | null>(null);

/** Field-keyed validation errors from the last refused write (a promo code, a delivery address). */
export const checkoutFieldErrors = signal<Readonly<Record<string, string>>>({});

/** Fold a response into the store, recording either its payload or the reason it failed. */
export function applyResponse<T>(res: CheckoutResponse<T>, apply: (data: T) => void): boolean {
	if (res.ok && res.data) {
		checkoutError.value = null;
		checkoutFieldErrors.value = {};
		checkoutNotice.value = res.message ?? null;
		apply(res.data);
		return true;
	}
	checkoutFieldErrors.value = res.errors ?? {};
	checkoutError.value = res.message ?? Object.values(res.errors ?? {})[0] ??
		"That change could not be saved just now.";
	return false;
}

/** Apply a basket read/write payload — every basket endpoint answers with this exact shape. */
export function applyBasket(
	data: { basket: Basket; baskets: BasketSummary[]; promo: AppliedPromo | null },
): void {
	basket.value = data.basket;
	baskets.value = data.baskets;
	promo.value = data.promo;
	activeBasketId.value = data.basket.id;
	writeStored("local", LocalKeys.BASKET_LAST, data.basket.id);
}

/**
 * Apply a checkout session projection.
 *
 * The adopted route is narrowed to the two the instrument list can actually show a selection for
 * (`isSelectableRoute`). Adopting the first AVAILABLE route would silently land on Google Pay or
 * PayPal whenever the wallet and cards were both refused — leaving the surface with a chosen route
 * and nothing selected anywhere on it, and a Buy Now that would charge through a sheet the buyer
 * never opened. Those three are express ACTIONS now, not selections.
 */
export function applySession(data: { session: CheckoutSessionContext }): void {
	session.value = data.session;
	cards.value = data.session.savedCards;
	defaultCardId.value = data.session.defaultCardId;
	if (!isSelectableRoute(chosenProvider.value)) {
		chosenProvider.value =
			data.session.providers.find((p) => p.available && isSelectableRoute(p.provider))?.provider ??
				null;
	}
	if (chosenCardId.value === null) chosenCardId.value = data.session.defaultCardId;
}

/** Apply a cards read/write payload. */
export function applyCards(data: { cards: SavedCard[]; defaultCardId: string | null }): void {
	cards.value = data.cards;
	defaultCardId.value = data.defaultCardId;
	if (chosenCardId.value && !data.cards.some((c) => c.id === chosenCardId.value)) {
		chosenCardId.value = data.defaultCardId;
	}
}
// #endregion

// #region Checkout composition (the buyer's unsubmitted choices)
/** The payment route the buyer has chosen; `null` until the session's first available one is adopted. */
export const chosenProvider = signal<PaymentProvider | null>(null);
/** The saved card a `card` payment will charge. */
export const chosenCardId = signal<string | null>(null);

/**
 * The ONE selection the wallet card and the saved-card list share.
 *
 * Both presentations read this and both write through {@link selectPaymentMethod}, so they cannot
 * hold two answers to one question. It is `computed` over the `(provider, cardId)` pair rather than
 * a third stored signal because that pair is what the charge payload, the route gates, the attempt
 * fingerprint and the persisted draft are all already expressed in — a parallel store would be a
 * second source of truth for the same fact, and the two would eventually disagree about what is
 * being charged.
 */
export const selectedMethodId = computed<PaymentMethodId | null>(() =>
	methodIdOf(chosenProvider.value, chosenCardId.value)
);

/** Select an instrument — the wallet, or one saved card. */
export function selectPaymentMethod(id: PaymentMethodId): void {
	const route = routeOfMethod(id);
	chosenProvider.value = route.provider;
	// A card selection carries its card; choosing the wallet KEEPS the last card, so coming back to
	// the list restores what the buyer had picked rather than clearing it under them.
	if (route.cardId !== null) chosenCardId.value = route.cardId;
}
/** The promo code as TYPED — never applied until the server resolves and prices it. */
export const promoDraft = signal<string>("");
/** Whether a charge is in flight — the footer's Pay control locks on this. */
export const submitting = signal<boolean>(false);
/** The outcome of the last charge attempt, or `null`. */
export const lastResult = signal<CheckoutResult | null>(null);

/**
 * A client-minted idempotency key, held for the LIFE OF ONE ATTEMPT.
 *
 * It must survive a retry (that is the entire point — a replayed key replays the stored outcome instead
 * of charging twice) and must NOT survive a deliberate change to what is being bought, or a second,
 * genuinely different purchase would silently replay the first one's result. {@link newAttemptKey}
 * mints one; {@link resetAttempt} drops it when the composition changes.
 */
export const attemptKey = signal<string | null>(null);

/** Mint (or reuse) the key for the current attempt. */
export function newAttemptKey(): string {
	if (attemptKey.value) return attemptKey.value;
	const key = `co_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
	attemptKey.value = key;
	return key;
}

/** Drop the current attempt key — call whenever what is being bought changes. */
export function resetAttempt(): void {
	attemptKey.value = null;
}

/*
 * `clientBlockers` / `payBlocked` were removed with the payment step's footer band.
 *
 * They existed to reconcile two regions: the band was SSR-rendered by its own slot resolver, so its
 * `blocked` prop was a snapshot of the first byte and could not see a line since deselected or a
 * booking since confirmed. The payment body now owns the only Pay control on the surface and derives
 * its gates in the same render that draws them, so there is no second region left to disagree with.
 */

/**
 * The live server-formatted checkout total, or `null` before the first read lands.
 *
 * Same reason as {@link payBlocked}: the footer's Pay control prints an AMOUNT, and its SSR prop goes
 * stale the moment a line is deselected. A control that names a figure must name the current one.
 */
export const payTotalDisplay = computed<string | null>(() =>
	session.value?.totals.total.display ?? null
);

/** The live server-formatted basket total (pre-fee), or `null` before the first read lands. */
export const basketTotalDisplay = computed<string | null>(() => basket.value?.net.display ?? null);
// #endregion

// #region Draft persistence (choices only — never an amount, never an instrument)
/** The shape persisted under {@link LocalKeys.CHECKOUT_DRAFT}, keyed by basket id. */
interface CheckoutDraft {
	provider: PaymentProvider | null;
	cardId: string | null;
	promoCode: string;
}

/** Persist the buyer's unsubmitted choices for the open basket. */
export function persistDraft(): void {
	const id = activeBasketId.value;
	if (!id) return;
	const draft: CheckoutDraft = {
		provider: chosenProvider.value,
		cardId: chosenCardId.value,
		promoCode: promoDraft.value,
	};
	writeStored("local", LocalKeys.CHECKOUT_DRAFT, JSON.stringify({ [id]: draft }));
}

/**
 * Restore the buyer's unsubmitted choices for a basket, if any were kept.
 *
 * A restored route is filtered through `isSelectableRoute` for the same reason the adoption is: a
 * draft written before the express routes stopped being selections would otherwise restore `paypal`
 * and leave the instrument list showing nothing chosen, with no way for the buyer to tell why.
 */
export function restoreDraft(basketId: string | null): void {
	if (!basketId) return;
	try {
		const raw = readStored("local", LocalKeys.CHECKOUT_DRAFT);
		if (!raw) return;
		const parsed = JSON.parse(raw) as Record<string, CheckoutDraft>;
		const draft = parsed[basketId];
		if (!draft) return;
		chosenProvider.value = isSelectableRoute(draft.provider ?? null) ? draft.provider : null;
		chosenCardId.value = draft.cardId ?? null;
		promoDraft.value = draft.promoCode ?? "";
	} catch {
		// A corrupt blob is not worth surfacing — the buyer simply re-picks.
	}
}

/** Clear the draft once a checkout has succeeded, so a finished purchase leaves nothing behind. */
export function clearDraft(): void {
	writeStored("local", LocalKeys.CHECKOUT_DRAFT, "{}");
	chosenProvider.value = null;
	chosenCardId.value = null;
	promoDraft.value = "";
	resetAttempt();
}
// #endregion

// #region Body ⇄ band bridges
/*
 * The `/basket` row density signal that used to live here is gone with the footer rig's density
 * slider: with no control to move it, a persisted zoom value could only ever hold the body in a
 * presentation nobody could get out of. The basket draws one row presentation.
 */

/** The header band's find-in-basket query, narrowing the lines the body draws. */
export const basketSearch = signal<string>("");

/** Dispatched whenever a mutation changed the basket, so every mounted region re-reads. */
export const BASKET_REFRESH_EVENT = "pj:basket-refresh";

/** Announce that the basket changed. */
export function notifyBasketChanged(): void {
	try {
		globalThis.dispatchEvent(new CustomEvent(BASKET_REFRESH_EVENT));
	} catch {
		// SSR / no window.
	}
}

/*
 * The `CHECKOUT_SUBMIT_EVENT` bridge that used to live here is gone with the footer band on the two
 * focus steps. It existed so a rig that held the Pay control could ask the body — which owns the
 * composition and the blockers — to run the charge. The payment step now carries its own commit
 * beside the total it commits to, so the action and the facts are in one component and there is
 * nothing left to bridge. `BASKET_REFRESH_EVENT` above stays: it crosses regions that still exist.
 */
// #endregion
