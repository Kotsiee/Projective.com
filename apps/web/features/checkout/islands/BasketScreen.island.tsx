import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useCallback, useEffect, useMemo, useRef } from "preact/hooks";
import "../styles/checkout.css";
import { Message } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { BasketService } from "../core/BasketService.ts";
import type { BasketPayload } from "../core/BasketService.ts";
import { createLineStore, lineSignals, syncLineStore } from "../core/basket-lines.ts";
import {
	densityOf,
	emptyScope,
	emptySearch,
	groupsFor,
	matchesQuery,
} from "../core/basket-view.ts";
import type { EmptyCopy } from "../core/basket-view.ts";
import {
	applyBasket,
	applyResponse,
	basket as basketSignal,
	BASKET_REFRESH_EVENT,
	baskets as basketsSignal,
	basketSearch,
	basketZoom,
	beginLineWrite,
	checkoutError,
	checkoutNotice,
	currentCheckoutContext,
	endLineWrite,
	isSelected,
	pendingLines,
	promo as promoSignal,
	promoDraft,
} from "../core/basket-state.ts";
import { useCheckoutSeam } from "../core/checkout-seam.ts";
import { BasketGroupSection } from "../components/BasketGroupSection.tsx";
import { BasketRow } from "../components/BasketRow.tsx";
import { BasketTotals } from "../components/BasketTotals.tsx";
import { PromoField } from "../components/PromoField.tsx";
import type { BasketBootstrap, BasketItem } from "../types/checkout-types.ts";
import type { CheckoutResponse } from "../types/results.ts";

/**
 * BasketScreen — the `/basket` BODY: the lines, grouped as the server grouped them, and the ability to
 * select among them.
 *
 * **The body views and selects; it does not act.** There is no checkout button, no bulk control, no
 * filter dropdown and no tab strip here — those are the footer band's and the header band's, per the
 * region contract (Decisions #60/#63). The two controls that do live here — the per-line delivery
 * address and the basket-wide discount code — are DATA the basket is missing, not calls to action, and
 * both commit against the line or the basket already on screen.
 *
 * **The money rule is absolute.** Every figure below is a server-computed `MoneyView` rendered through
 * its `display` string. This island never sums a subtotal, applies a discount, multiplies a unit price
 * by a quantity or converts a currency — every write answers with the WHOLE basket, so state is
 * replaced wholesale rather than patched, and a locally-patched total (the second arithmetic path) can
 * never exist to disagree with the server's.
 *
 * **The optimistic layer covers non-monetary state only.** A checkbox moves at once because the reader
 * pressed it; the total under it does not move until the server has agreed, because an optimistic
 * price is a number the buyer could act on that nobody has committed to.
 *
 * **A failed write is never silent.** `/messaging` shipped three call sites that rendered a failed
 * fetch as an empty result; on a basket the same silence is worse, because a removal that did not land
 * looks exactly like one that did until the buyer pays for it. Every response goes through
 * `applyResponse`, which records the reason, and the reason is rendered.
 */

// #region Props
/** Props for {@link BasketScreen}. */
export interface BasketScreenProps {
	/** The SSR-resolved basket, its siblings and any attached promo. */
	initial: BasketBootstrap;
}
// #endregion

export default function BasketScreen(props: BasketScreenProps): JSX.Element {
	const { initial } = props;

	const promoBusy = useSignal(false);
	const lineStore = useMemo(createLineStore, []);
	const inFlight = useRef(false);
	const queued = useRef(false);

	/**
	 * The basket THIS page resolved server-side — the route's own answer, and the only one it obeys.
	 *
	 * The shared store is genuinely shared: `BasketDrawer` mounts on every authenticated page through
	 * `UserActions`, and on mount it reads the acting account's DEFAULT basket and folds the result into
	 * the same signals. Its guard ("skip when a surface has already painted") cannot hold here, because
	 * a page body paints in an effect and the drawer's answer arrives asynchronously after it — measured:
	 * `/basket?basket=bk-wishlist` SSR'd the wishlist correctly and was then replaced, client-side, by
	 * the default basket, with the header band still naming the wishlist.
	 *
	 * Pinning the id makes the page correct under EVERY interleaving rather than under a lucky one: a
	 * write always targets the basket on screen, and a store value for a different basket is ignored
	 * below. Switching basket is a navigation, so `initial` is re-resolved and the pin moves with it.
	 */
	const pageBasketId = initial.basket.id || null;

	/** The read context, with this page's basket forced over whatever the shared signal now holds. */
	const scopedContext = useCallback(() => {
		const ctx = currentCheckoutContext();
		return pageBasketId ? { ...ctx, basketId: pageBasketId } : ctx;
	}, [pageBasketId]);

	/**
	 * Re-read the basket.
	 *
	 * Coalesced rather than fired per call: the header band pulses a refresh on every keystroke of its
	 * find-in-basket field, and a request per character would put a burst of reads in flight whose
	 * responses could land out of order. At most one read runs at a time and at most one is queued
	 * behind it, so a burst resolves to a first answer and a final one.
	 */
	const reload = useCallback(async (): Promise<void> => {
		if (inFlight.current) {
			queued.current = true;
			return;
		}
		inFlight.current = true;
		try {
			const res = await BasketService.get(scopedContext());
			applyResponse(res, applyBasket);
		} finally {
			inFlight.current = false;
		}
		if (queued.current) {
			queued.current = false;
			await reload();
		}
	}, [scopedContext]);

	// Seed the shared store from SSR BEFORE the seam hook can trigger its reconciling read, so the
	// first paint and the first refetch describe the same basket.
	useEffect(() => {
		basketSignal.value = initial.basket;
		basketsSignal.value = initial.baskets;
		promoSignal.value = initial.promo;
		if (initial.promo && promoDraft.value === "") promoDraft.value = initial.promo.code;
	}, [initial]);

	useCheckoutSeam({
		basketId: initial.basket.id || null,
		owner: initial.owner,
		display: initial.display,
		onRefetch: () => void reload(),
	});

	useEffect(() => {
		const handler = () => void reload();
		globalThis.addEventListener?.(BASKET_REFRESH_EVENT, handler);
		return () => globalThis.removeEventListener?.(BASKET_REFRESH_EVENT, handler);
	}, [reload]);

	/*
	 * Two reasons this reads `initial` rather than the computed `activeLines`/`savedLines`.
	 *
	 * On the SERVER those computeds are `null`-backed until the seeding effect runs, so the first byte
	 * would be an empty state that hydration then replaces. On the CLIENT the store may hold a DIFFERENT
	 * basket entirely — see `pageBasketId` — and a page that rendered whatever arrived last would show
	 * one basket's lines under another basket's name.
	 */
	const stored = basketSignal.value;
	const mine = stored !== null && (pageBasketId === null || stored.id === pageBasketId);
	const current = mine ? stored : initial.basket;
	const attachedPromo = mine ? promoSignal.value : initial.promo;

	const rawQuery = basketSearch.value.trim();
	const query = rawQuery.toLowerCase();
	const activeItems = current.items.filter((item) => !item.savedForLater);
	const parkedItems = current.items.filter((item) => item.savedForLater);
	const visibleActive = activeItems.filter((item) => matchesQuery(item, query));
	const visibleParked = parkedItems.filter((item) => matchesQuery(item, query));
	const sections = groupsFor(current, visibleActive);

	/*
	 * Three distinct nothings, told apart because they mean three different things: a basket with no
	 * lines at all, a search that matched none of the active ones, and an active list that is empty
	 * only because everything in it has been parked onto the shelf below.
	 */
	const basketEmpty = current.items.length === 0;
	const activeEmpty = !basketEmpty && visibleActive.length === 0;
	const density = densityOf(basketZoom.value);
	const busySet = pendingLines.value;

	// Keep every controlled field in step with the server's answer, and forget lines that have gone.
	// In an effect, never during render: writing a signal this component is subscribed to while it
	// renders is how a surface earns an infinite loop.
	useEffect(() => {
		syncLineStore(lineStore, current.items, {
			selectedOf: isSelected,
			busy: pendingLines.peek(),
		});
	});

	// #region Writes
	/** Run one line mutation with its in-flight marker, and fold the answer (or the refusal) back in. */
	const writeLine = async (
		line: BasketItem,
		run: () => Promise<CheckoutResponse<BasketPayload>>,
		selection?: boolean,
	): Promise<boolean> => {
		beginLineWrite(line.id, selection);
		const res = await run();
		const ok = applyResponse(res, applyBasket);
		endLineWrite(line.id);
		return ok;
	};

	const onToggle = (line: BasketItem, next: boolean) => {
		void writeLine(
			line,
			() =>
				BasketService.updateItem(
					{ basketItemId: line.id, isSelectedForCheckout: next },
					scopedContext(),
				),
			next,
		);
	};

	/**
	 * Commit a quantity — and, on a line that holds seats, the seat count with it.
	 *
	 * A group-session line carries both fields as the same number, so writing one without the other is
	 * how a line comes to claim three seats while charging for two.
	 */
	const onQuantity = (line: BasketItem, next: number) => {
		if (next === line.quantity) return;
		void writeLine(line, () =>
			BasketService.updateItem(
				{
					basketItemId: line.id,
					quantity: next,
					...(line.seats !== null ? { seats: next } : {}),
				},
				scopedContext(),
			));
	};

	const onPark = (line: BasketItem, parked: boolean) => {
		void writeLine(line, () =>
			BasketService.moveItem(
				{ basketItemId: line.id, toBasketId: current.id, savedForLater: parked },
				scopedContext(),
			));
	};

	const onRemove = (line: BasketItem) => {
		void writeLine(
			line,
			() => BasketService.removeItem({ basketItemId: line.id }, scopedContext()),
		);
	};

	const onEmail = (line: BasketItem, address: string) => {
		void (async () => {
			const ok = await writeLine(line, () =>
				BasketService.updateItem(
					{ basketItemId: line.id, destinationEmail: address },
					scopedContext(),
				));
			// Hand the field back to the server's value only once the server actually holds it; until
			// then the reader's copy is the only one that exists.
			if (ok) lineSignals(lineStore, line).emailTouched.value = false;
		})();
	};

	const onPromo = (code: string | null) => {
		void (async () => {
			promoBusy.value = true;
			const res = await BasketService.applyPromo(
				{ basketId: current.id, code },
				scopedContext(),
			);
			const ok = applyResponse(res, applyBasket);
			if (ok && code === null) promoDraft.value = "";
			promoBusy.value = false;
		})();
	};
	// #endregion

	/** Build one row; shared by the grouped sections and the parked shelf. */
	const row = (item: BasketItem, parked: boolean) => (
		<BasketRow
			key={item.id}
			item={item}
			signals={lineSignals(lineStore, item)}
			busy={busySet.has(item.id)}
			selected={isSelected(item)}
			parked={parked}
			onToggle={onToggle}
			onQuantity={onQuantity}
			onPark={onPark}
			onRemove={onRemove}
			onEmail={onEmail}
		/>
	);

	return (
		<div class="bsk" data-density={density}>
			{
				/*
				 * Every mutation on this surface confirms itself visually by the row changing. That channel
				 * does not exist for a screen reader, so the server's own success sentence is published to a
				 * polite live region — and only there, because rendering it visibly would put a banner on
				 * screen after every checkbox.
				 */
			}
			<span class="ui-visually-hidden" role="status">{checkoutNotice.value ?? ""}</span>

			{checkoutError.value && (
				<div class="bsk__feedback">
					<Message
						severity="danger"
						closable
						text={checkoutError.value}
						onClose={() => {
							checkoutError.value = null;
						}}
					/>
				</div>
			)}

			{current.unavailableCount > 0 && (
				<div class="bsk__feedback">
					<Message
						severity="warning"
						text={current.unavailableCount === 1
							? "One line can no longer be bought. It is marked below and is left out of the total."
							: `${current.unavailableCount} lines can no longer be bought. They are marked below and are left out of the total.`}
					/>
				</div>
			)}

			{basketEmpty ? <EmptyState copy={emptyScope(current)} /> : (
				<>
					{activeEmpty
						? (
							<EmptyState
								copy={rawQuery === ""
									? emptyScope(current)
									: emptySearch(rawQuery, visibleParked.length)}
							/>
						)
						: sections.map((section) => (
							<BasketGroupSection key={section.key} section={section}>
								{section.items.map((item) => row(item, false))}
							</BasketGroupSection>
						))}

					{visibleParked.length > 0 && (
						<section class="bsk-saved" id="saved" aria-labelledby="bsk-saved-head">
							<header class="bsk-saved__head">
								<span class="bsk-saved__icon" aria-hidden="true">
									<Icon name="bookmark" size="sm" />
								</span>
								<h2 class="bsk-saved__title" id="bsk-saved-head">Saved for later</h2>
								<p class="bsk-saved__note">
									Parked, not bought. Nothing here counts toward the total.
								</p>
							</header>
							<ul class="bsk-saved__items">
								{visibleParked.map((item) =>
									row(item, true)
								)}
							</ul>
						</section>
					)}

					<PromoField promo={attachedPromo} busy={promoBusy.value} onApply={onPromo} />
					<BasketTotals basket={current} promo={attachedPromo} />
				</>
			)}
		</div>
	);
}

// #region Empty state
/**
 * The empty region, named for the scope it is empty FOR.
 *
 * `role="status"` because it replaces content the reader was expecting: a search that matched nothing
 * must say so, rather than leaving a silent gap that reads as a broken filter.
 */
function EmptyState({ copy }: { copy: EmptyCopy }): JSX.Element {
	return (
		<div class="bsk-empty" role="status">
			<span class="bsk-empty__icon" aria-hidden="true">
				<Icon name="basket" size="xl" />
			</span>
			<p class="bsk-empty__title">{copy.title}</p>
			<p class="bsk-empty__note">{copy.note}</p>
		</div>
	);
}
// #endregion
