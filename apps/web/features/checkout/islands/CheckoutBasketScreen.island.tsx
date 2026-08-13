import type { JSX, RefObject } from "preact";
import { type Signal, signal, useSignal } from "@preact/signals";
import { useCallback, useEffect, useMemo, useRef } from "preact/hooks";
import "../styles/checkout.css";
import { Message, Popover } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { BasketService } from "../core/BasketService.ts";
import type { BasketPayload } from "../core/BasketService.ts";
import { createLineStore, lineSignals, syncLineStore } from "../core/basket-lines.ts";
import { emptyScope, emptySearch, groupsFor, matchesQuery } from "../core/basket-view.ts";
import type { EmptyCopy } from "../core/basket-view.ts";
import { checkoutStepHref } from "../core/basket-model.ts";
import { basketListsFrom } from "../core/lists-model.ts";
import {
	applyBasket,
	applyResponse,
	basket as basketSignal,
	BASKET_REFRESH_EVENT,
	baskets as basketsSignal,
	basketSearch,
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
import {
	activeListId,
	contributionOptedIn,
	lists as listsSignal,
	seedStep,
} from "../core/checkout-state.ts";
import { useCheckoutSeam } from "../core/checkout-seam.ts";
import {
	BasketCategorySection,
	categoriesOf,
	categoryTallies,
} from "../components/BasketGroupSection.tsx";
import { BasketEngagement } from "../components/BasketEngagement.tsx";
import { BasketTicketModal } from "../components/BasketTicketModal.tsx";
import { BasketListCard } from "../components/BasketListCard.tsx";
import { BasketRow, rowDomId } from "../components/BasketRow.tsx";
import { Amount } from "../components/Amount.tsx";
import { PromoField } from "../components/PromoField.tsx";
import type {
	BasketBootstrap,
	BasketItem,
	ProcessingContributionOffer,
} from "../types/checkout-types.ts";
import type { CheckoutResponse } from "../types/results.ts";

/**
 * CheckoutBasketScreen — step 1's BODY: the lines, grouped as the server grouped them, the shelf they
 * can be parked on, and the summary that says what they come to.
 *
 * **The body views and selects; the chrome acts.** There is no step navigation, no bulk control, no
 * filter dropdown and no tab strip here — those belong to the lane and the two frame bands, per the
 * region contract (Decisions #60 / #63). The controls that DO live here are all data the basket is
 * missing or a decision about the basket itself: a line's delivery address, the discount code, the
 * voluntary gateway contribution, and the one control that advances the flow from the summary the
 * buyer has just read.
 *
 * **The money rule is absolute.** Every figure below is a server-computed `MoneyView` rendered through
 * {@link Amount}. This island never sums a subtotal, applies a discount, multiplies a unit price by a
 * quantity or converts a currency — every write answers with the WHOLE basket, so state is replaced
 * wholesale rather than patched, and a locally-patched total (the second arithmetic path) can never
 * exist to disagree with the server's.
 *
 * **The optimistic layer covers non-monetary state only.** A checkbox moves at once because the reader
 * pressed it; the total under it does not move until the server has agreed, because an optimistic
 * price is a number the buyer could act on that nobody has committed to.
 *
 * **A failed write is never silent.** `/messaging` shipped three call sites that rendered a failed
 * fetch as an empty result; on a basket the same silence is worse, because a removal that did not land
 * looks exactly like one that did until the buyer pays for it. Every response goes through
 * `applyResponse`, which records the reason, and the reason is rendered.
 *
 * ## Two presentations, chosen by what the list IS
 *
 * The DEFAULT basket is the thing being bought, so its lines render as full {@link BasketRow}s with
 * selection, quantity, kind facts and the whole price block. A **named list** and the **parked shelf**
 * are shelves — a reader triages them rather than checking them out line by line — so their lines
 * render as {@link BasketListCard}s whose affordances are the three moves a shelf actually needs.
 *
 * ## The right rail is TWO cards, not one
 *
 * The **summary** answers "what am I about to pay, and for how many things" and carries the single
 * control that advances the flow. The **promo card** is a separate object beneath it because applying
 * a code is a decision about the basket, not part of reading its total — folding it into the summary
 * put a text field between the figure and the button that commits to it.
 *
 * The summary's headline figure is the basket's own `net` — the last figure this step can state
 * honestly, since the platform fee and any tax resolve against a payment route the buyer has not
 * chosen yet. It is stated ONCE, with a line tally beside it saying what it is a price for; the
 * arithmetic behind it (subtotal, creator discounts, an applied promo) belongs to the Payment step's
 * invoice panel, where the fee and the route are settled and the breakdown can be complete rather
 * than provisional. `BasketTotals` renders that breakdown and is deliberately not mounted here.
 */

// #region Props
/** Props for {@link CheckoutBasketScreen}. */
export interface CheckoutBasketScreenProps {
	/** The SSR-resolved basket, its siblings and any attached promo. */
	initial: BasketBootstrap;
	/**
	 * The voluntary gateway-fee contribution, when the resolved payment route carries a third-party
	 * cost. `null` when the server made no offer — the checkbox is then absent rather than disabled,
	 * because an offer nobody is making should not occupy a row.
	 */
	processingOffer: ProcessingContributionOffer | null;
}
// #endregion

export default function CheckoutBasketScreen(props: CheckoutBasketScreenProps): JSX.Element {
	const { initial } = props;

	const promoBusy = useSignal(false);
	const deliveryOpen = useSignal(false);
	/** The ticket line open in the board's ticket surface, or `null`. */
	const openTicketLine = useSignal<BasketItem | null>(null);
	/** The line the flagged-lines notice last sent the reader to; marked for a moment on arrival. */
	const flaggedId = useSignal<string | null>(null);
	/** Which flagged line the next press of the notice's control goes to. */
	const flagCursor = useSignal(0);
	// `ReturnType<typeof setTimeout>` rather than `number`: this file type-checks under Deno's lib, where
	// the timer handle is a `Timeout` object, not the DOM's numeric id.
	const flagTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	/*
	 * One cached `Signal` per bulk checkbox (a category heading's, an engagement block's), keyed by
	 * region id. A `useRef` Map rather than state: creating these during render must not itself
	 * schedule a render, and the signals are re-pointed at the derived truth each pass by
	 * `bulkStateFor`.
	 */
	const bulkStore = useRef(new Map<string, Signal<boolean>>());
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
	// first paint and the first refetch describe the same basket. The step signals are seeded from the
	// same place for the same reason: every other region reads them and none of them fetches.
	useEffect(() => {
		basketSignal.value = initial.basket;
		basketsSignal.value = initial.baskets;
		promoSignal.value = initial.promo;
		if (initial.promo && promoDraft.value === "") promoDraft.value = initial.promo.code;
		seedStep("basket");
		contributionOptedIn.value = props.processingOffer?.optedIn ?? false;
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
	const siblings = mine && basketsSignal.value.length > 0 ? basketsSignal.value : initial.baskets;

	// Republish the lane's navigation model from the basket the BODY is actually showing, so the two
	// regions can never describe different lists. The lane reads; only this region writes.
	useEffect(() => {
		listsSignal.value = basketListsFrom({ ...initial, basket: current, baskets: [...siblings] });
		activeListId.value = current.id || null;
	}, [current, siblings]);

	const rawQuery = basketSearch.value.trim();
	const query = rawQuery.toLowerCase();
	const activeItems = current.items.filter((item) => !item.savedForLater);
	const parkedItems = current.items.filter((item) => item.savedForLater);
	const visibleActive = activeItems.filter((item) => matchesQuery(item, query));
	const visibleParked = parkedItems.filter((item) => matchesQuery(item, query));
	const sections = groupsFor(current, visibleActive);

	/*
	 * The summary's line tally, over the WHOLE basket's server groups rather than the search-narrowed
	 * ones: the summary describes the basket, not the current filter. `categoryTallies` adds up the
	 * server's own per-group `itemCount`s — counting lines, never money — and the headline figure beside
	 * it is the basket's own `itemCount` rather than anything derived here.
	 */
	const tallies = categoryTallies(current.groups);

	/**
	 * The distinct addresses this basket's digital deliverables are being sent to.
	 *
	 * Read from the lines themselves (`destinationEmail`), which is the only place this surface holds
	 * one — the basket bootstrap carries no buyer profile. When no line has an address yet the chip is
	 * ABSENT rather than showing a placeholder: an invented delivery address is the single worst thing
	 * this card could guess at, and an empty row says nothing a reader could act on.
	 */
	const destinationEmails = (() => {
		const seen = new Map<string, number>();
		for (const item of activeItems) {
			const address = item.destinationEmail;
			if (!address) continue;
			seen.set(address, (seen.get(address) ?? 0) + 1);
		}
		return [...seen.entries()].map(([address, count]) => ({ address, count }));
	})();

	// #region Opening a line
	/** Open a ticket in the board's own ticket surface — see {@link BasketTicketModal}. */
	const openTicket = (line: BasketItem) => {
		openTicketLine.value = line;
	};

	/**
	 * Open a booked session.
	 *
	 * A deliberate PLACEHOLDER. There is no session surface to open yet — rescheduling and joining are
	 * settled at the confirmation step and on the calendar, neither of which the basket can host — so
	 * this announces itself and does nothing else. It is wired rather than absent so the row's click
	 * target, its focus behaviour and its keyboard activation are all real now, and the day the surface
	 * lands the only change is what this function calls.
	 */
	const openSession = (line: BasketItem) => {
		checkoutNotice.value =
			`Session details for ${line.title} open from your calendar once this booking is paid for.`;
	};
	// #endregion

	// #region Jump to a flagged line
	/**
	 * The unavailable lines the notice is ABOUT, in the order they are drawn.
	 *
	 * Read from the visible set rather than from every line in the basket: a jump has to land somewhere,
	 * and a search that has hidden the flagged row would otherwise send the reader to an element that
	 * is not in the document.
	 */
	const flaggedLines = visibleActive.filter((item) => !item.available);

	/**
	 * Take the reader to the next flagged line, and mark it when they arrive.
	 *
	 * The same shape as the chat feed's pinned-message jump (`ChatFeed.jumpTo` / `PinnedBanner`): scroll
	 * to the target, mark it for a moment so the destination is obvious, then let the mark expire. The
	 * click also ADVANCES the cursor, so pressing the control repeatedly walks the whole set rather than
	 * returning to the first one — which is the behaviour that matters when the notice says "3 lines".
	 *
	 * Three details are deliberate:
	 *
	 * - The row is found by its DOM id (`rowDomId`) rather than by a ref map. The basket is not
	 *   virtualized, so every drawn row is genuinely in the document, and an id survives the row moving
	 *   between a group and the shelf without any bookkeeping.
	 * - `block: "center"` rather than `"start"`, because the frame's header band is sticky and a row
	 *   scrolled to the top of the scrollport lands underneath it.
	 * - Smooth scrolling is dropped under `prefers-reduced-motion`. The jump still happens — a reduced-
	 *   motion preference asks for no animation, not for no navigation.
	 */
	const jumpToFlagged = () => {
		if (flaggedLines.length === 0) return;
		const target = flaggedLines[flagCursor.value % flaggedLines.length];
		flagCursor.value = (flagCursor.value + 1) % flaggedLines.length;

		const node = document.getElementById(rowDomId(target));
		if (!node) return;

		const still = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
		node.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" });

		flaggedId.value = target.id;
		if (flagTimer.current !== null) clearTimeout(flagTimer.current);
		flagTimer.current = setTimeout(() => {
			if (flaggedId.value === target.id) flaggedId.value = null;
			flagTimer.current = null;
		}, 2400);
	};

	// A mark left running past unmount would fire into a component that no longer exists.
	useEffect(() => () => {
		if (flagTimer.current !== null) clearTimeout(flagTimer.current);
	}, []);
	// #endregion

	/*
	 * Three distinct nothings, told apart because they mean three different things: a basket with no
	 * lines at all, a search that matched none of the active ones, and an active list that is empty
	 * only because everything in it has been parked onto the shelf below.
	 */
	const basketEmpty = current.items.length === 0;
	const activeEmpty = !basketEmpty && visibleActive.length === 0;
	const busySet = pendingLines.value;
	const isShelf = !current.isDefault;
	const destinations = siblings.filter((entry) => entry.id !== current.id);

	/**
	 * Whether the open list is one the SERVER derived rather than one the buyer made.
	 *
	 * An auto-generated list is a VIEW across every basket and shelf for one engagement — the lane's
	 * Tickets and Sessions entries. It has no shelf of its own, because a line parked from one of the
	 * buyer's real baskets is still parked THERE; showing a "Saved for later" section on a view would
	 * invite a move whose destination the view cannot name. The section is therefore hidden entirely
	 * rather than rendered empty.
	 *
	 * Detected from the id's namespace, which is the backend's own (`ticket:`/`session:` — see
	 * `derivedLists`), so the two sides cannot disagree about what a derived list is.
	 */
	const isDerivedList = /^(ticket|session):/.test(current.id);

	// Keep every controlled field in step with the server's answer, and forget lines that have gone.
	// In an effect, never during render: writing a signal this component is subscribed to while it
	// renders is how a surface earns an infinite loop.
	useEffect(() => {
		syncLineStore(lineStore, current.items, {
			selectedOf: isSelected,
			busy: pendingLines.peek(),
		});
	});

	/**
	 * The bound state for one bulk selection checkbox — a category heading's, or an engagement
	 * block's.
	 *
	 * Two things it has to get right:
	 *
	 * - The bound value is a **`Signal`**, cached per key across renders. The field primitives seed
	 *   their internal signal from a raw value exactly once (`useControllable` memoises on `[]`), so
	 *   a bulk checkbox bound to a plain boolean would freeze at whatever it first painted while the
	 *   lines beneath it moved. The signal is re-pointed at the derived truth on every render, which
	 *   is what keeps it honest after a line-level toggle.
	 * - A line the server has marked unavailable is **not selectable**, so it is excluded from the
	 *   tally entirely. Counting it would leave a heading permanently indeterminate with nothing the
	 *   buyer could do about it.
	 *
	 * Toggling issues one write per line. That is N sequential requests rather than a bulk endpoint —
	 * a known limitation of this surface, not an oversight; the server exposes no bulk selection call.
	 */
	const bulkStateFor = (key: string, lines: readonly BasketItem[]) => {
		const selectable = lines.filter((line) => line.available);
		const chosen = selectable.filter((line) => isSelected(line));
		const all = selectable.length > 0 && chosen.length === selectable.length;

		let held = bulkStore.current.get(key);
		if (!held) {
			held = signal(all);
			bulkStore.current.set(key, held);
		} else if (held.peek() !== all) {
			held.value = all;
		}

		return {
			signal: held,
			indeterminate: chosen.length > 0 && !all,
			disabled: selectable.length === 0 ||
				selectable.some((line) => busySet.has(line.id)),
			toggle: (next: boolean) => {
				for (const line of selectable) {
					if (isSelected(line) !== next) onToggle(line, next);
				}
			},
		};
	};

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

	/*
	 * The quantity write is GONE with the control that drove it. Nothing on this surface changes a line's
	 * quantity any more — a basket line's count is settled where it is added, and the row now reports it
	 * through the unit price and the line total rather than offering a stepper beside them.
	 */

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

	/**
	 * The engagement-level moves: park or remove every line bought against one project or service.
	 *
	 * Sequential, not parallel. Each write answers with the WHOLE basket, so two in flight at once would
	 * race and the loser's answer would overwrite the winner's — the basket would end up describing a
	 * state neither call produced. This is N requests for N lines, which is the same limitation the
	 * footer rig's bulk operations carry and for the same reason: `finance.basket_items` exposes no
	 * multi-row mutation yet.
	 */
	const forGroup = async (
		lines: readonly BasketItem[],
		run: (line: BasketItem) => Promise<CheckoutResponse<BasketPayload>>,
	): Promise<void> => {
		for (const line of lines) await writeLine(line, () => run(line));
	};

	const onParkGroup = (lines: readonly BasketItem[]) => {
		void forGroup(lines, (line) =>
			BasketService.moveItem(
				{ basketItemId: line.id, toBasketId: current.id, savedForLater: true },
				scopedContext(),
			));
	};

	const onRemoveGroup = (lines: readonly BasketItem[]) => {
		void forGroup(
			lines,
			(line) => BasketService.removeItem({ basketItemId: line.id }, scopedContext()),
		);
	};

	/**
	 * Move a line into another named list.
	 *
	 * `savedForLater: false` travels with it deliberately: a line dragged out of the shelf and into a
	 * list must arrive un-parked, or it lands invisible on the far side.
	 */
	const onMoveToList = (line: BasketItem, toBasketId: string) => {
		void writeLine(line, () =>
			BasketService.moveItem(
				{ basketItemId: line.id, toBasketId, savedForLater: false },
				scopedContext(),
			));
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

	/** Build one full row; the default basket's presentation. */
	const row = (item: BasketItem, parked: boolean) => (
		<BasketRow
			key={item.id}
			item={item}
			signals={lineSignals(lineStore, item)}
			busy={busySet.has(item.id)}
			selected={isSelected(item)}
			parked={parked}
			flagged={flaggedId.value === item.id}
			onToggle={onToggle}
			onPark={onPark}
			onRemove={onRemove}
		/>
	);

	/** Build one shelf card; the presentation of a named list and of the parked shelf. */
	const card = (item: BasketItem) => (
		<BasketListCard
			key={item.id}
			item={item}
			busy={busySet.has(item.id)}
			destinations={destinations}
			onMoveToBasket={(line) => {
				// A parked line comes back to the basket it is already in; a line sitting in a NAMED
				// list has to travel to the default one, which is the basket an add-to-basket lands in
				// and therefore the one "the basket" means to a reader.
				const home = siblings.find((entry) => entry.isDefault);
				if (line.savedForLater || !home || home.id === current.id) onPark(line, false);
				else onMoveToList(line, home.id);
			}}
			onMoveToList={onMoveToList}
			onRemove={onRemove}
		/>
	);

	const checkoutTarget = checkoutStepHref("details", current.id || null, initial.owner);

	const one = current.unavailableCount === 1;

	return (
		<div class="bsk" data-shelf={isShelf ? "true" : undefined}>
			{
				/*
				 * Every mutation on this surface confirms itself visually by the row changing. That channel
				 * does not exist for a screen reader, so the server's own success sentence is published to a
				 * polite live region — and only there, because rendering it visibly would put a banner on
				 * screen after every checkbox.
				 */
			}
			<span class="ui-visually-hidden" role="status">{checkoutNotice.value ?? ""}</span>

			{
				/*
				 * The list's own name. A basket is the buyer's default pile and reads as "Your Basket"; a
				 * named list reads as itself, with a kicker saying what a list IS — that nothing parked in one
				 * is being charged for, which its name alone never says.
				 */
			}
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
					<Message severity="warning">
						<span class="bsk__notice">
							<span class="bsk__notice-text">
								{one
									? "One line can no longer be bought. It is marked below and is left out of the total."
									: `${current.unavailableCount} lines can no longer be bought. They are marked below and are left out of the total.`}
							</span>
							{flaggedLines.length > 0 && (
								<button
									type="button"
									class="bsk__notice-jump"
									onClick={jumpToFlagged}
									aria-label={one
										? "Show the line that can no longer be bought"
										: `Show the next of ${flaggedLines.length} lines that can no longer be bought`}
								>
									<Icon name="arrow-down" size="2xs" />
									<span>{one ? "Show me" : "Show the next one"}</span>
								</button>
							)}
						</span>
					</Message>
				</div>
			)}

			<header class="bsk__head">
				<h1 class="bsk__title">{isShelf ? current.name : "Your Basket"}</h1>
				{isShelf && <p class="bsk__kicker">Parked, not bought — nothing here is charged for.</p>}
			</header>

			{basketEmpty ? <EmptyState copy={emptyScope(current)} /> : (
				<div class="bsk__layout">
					<div class="bsk__main">
						{activeEmpty
							? (
								<EmptyState
									copy={rawQuery === ""
										? emptyScope(current)
										: emptySearch(rawQuery, visibleParked.length)}
								/>
							)
							: categoriesOf(sections).map((category) => {
								const lines = category.groups.flatMap((group) => group.items);
								const bulk = bulkStateFor(`cat:${category.key}`, lines);
								return (
									<BasketCategorySection
										key={category.key}
										category={category}
										selection={bulk.signal}
										indeterminate={bulk.indeterminate}
										disabled={bulk.disabled}
										onToggleAll={bulk.toggle}
									>
										{
											/*
											 * A FLAT category (Products, and a shelf) is a run of standalone purchases, so
											 * each line is its own item. A NESTED one is a run of engagements, and each
											 * engagement is ONE item carrying its own tickets or sessions — which is why
											 * the two branches render different components rather than the same row twice.
											 */
										}
										{category.flat
											? (
												<ul class="bsk-cat__lines">
													{lines.map((item) => isShelf ? card(item) : row(item, false))}
												</ul>
											)
											: (
												<ul class="bsk-cat__lines">
													{category.groups.map((group) => {
														const block = bulkStateFor(`grp:${group.key}`, group.items);
														return (
															<BasketEngagement
																key={group.key}
																section={group}
																selection={block.signal}
																indeterminate={block.indeterminate}
																disabled={block.disabled}
																busy={group.items.some((line) => busySet.has(line.id))}
																onToggleAll={block.toggle}
																signalsOf={(line) => lineSignals(lineStore, line)}
																isBusy={(line) => busySet.has(line.id)}
																onToggle={onToggle}
																onPark={onPark}
																onRemove={onRemove}
																onParkAll={() => onParkGroup(group.items)}
																onRemoveAll={() => onRemoveGroup(group.items)}
																onOpenTicket={openTicket}
																onOpenSession={openSession}
															/>
														);
													})}
												</ul>
											)}
									</BasketCategorySection>
								);
							})}

						{visibleParked.length > 0 && !isDerivedList && (
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
										card(item)
									)}
								</ul>
							</section>
						)}
					</div>

					<aside class="bsk__aside" aria-label="Order summary">
						<section class="bsk-summary" aria-labelledby="bsk-summary-head">
							<h2 class="ui-visually-hidden" id="bsk-summary-head">Order summary</h2>

							{
								/*
								 * Where the digital deliverables in this basket are going. It DISCLOSES rather
								 * than edits: the address belongs to a line and is changed on that line, so
								 * offering a second place to set it would give the basket two answers to the
								 * same question. The panel names every distinct address and how many lines go
								 * to each, which is the fact a single chip cannot state.
								 */
							}
							{destinationEmails.length > 0 && (
								<Popover
									open={deliveryOpen}
									placement="bottom-start"
									label="Delivery addresses"
									class="bsk-menu"
									trigger={(api) => (
										<button
											type="button"
											class="bsk-summary__dest"
											aria-haspopup="dialog"
											aria-expanded={api.expanded ? "true" : "false"}
											aria-controls={api.panelId}
											onClick={api.toggle}
											ref={api.ref as RefObject<HTMLButtonElement>}
										>
											<Icon name="mail" size="2xs" />
											<span class="bsk-summary__dest-value">
												{destinationEmails[0].address}
											</span>
											{destinationEmails.length > 1 && (
												<span class="bsk-summary__dest-more">
													+{destinationEmails.length - 1}
												</span>
											)}
											<Icon name="chevron-down" size="2xs" />
										</button>
									)}
								>
									{
										/*
										 * The wording follows where the address is now COLLECTED. The row no longer
										 * carries a field, so telling a reader it is "set on each line" would point
										 * them at a control this surface stopped offering; the Details step owns the
										 * question and can still override per line once they get there.
										 */
									}
									<p class="bsk-dest__note">
										Digital items are sent here. You can change this on the next step.
									</p>
									<ul class="bsk-dest__list">
										{destinationEmails.map((entry) => (
											<li key={entry.address} class="bsk-dest__item">
												<span class="bsk-dest__email">{entry.address}</span>
												<span class="bsk-dest__count">
													{entry.count} {entry.count === 1 ? "line" : "lines"}
												</span>
											</li>
										))}
									</ul>
								</Popover>
							)}

							{
								/*
								 * The headline figure and what it is a price FOR, side by side. `net` is the
								 * server's own figure passed through — the tally beside it counts lines, which
								 * is not money arithmetic.
								 */
							}
							<div class="bsk-summary__figures">
								<p class="bsk-summary__total">
									<span class="bsk-summary__total-label">Total</span>
									<Amount value={current.net} size="hero" />
								</p>

								<div class="bsk-summary__tally">
									<p class="bsk-summary__count">
										{current.itemCount} {current.itemCount === 1 ? "Item" : "Items"}
									</p>
									{tallies.length > 0 && (
										<ul class="bsk-summary__parts">
											{tallies.map((part) => <li key={part.key}>{part.count} {part.label}</li>)}
										</ul>
									)}
								</div>
							</div>
							<a
								class="ui-button ui-button--warning ui-button--filled ui-button--size-lg ui-button--fluid ui-button--rounded bsk-summary__cta"
								href={checkoutTarget}
							>
								<span class="ui-button__label">Proceed to Checkout</span>
							</a>

							<p class="bsk-summary__reassure">
								Nothing is charged until you confirm on the payment step.
							</p>
						</section>

						<PromoField promo={attachedPromo} busy={promoBusy.value} onApply={onPromo} />
					</aside>
				</div>
			)}

			{
				/*
				 * The board's own ticket surface, opened in place from a ticket row.
				 *
				 * Mounted at the body's root rather than inside the row that opens it: the modal moves its
				 * panel through `BodyPortal`, and a row deep inside `.bsk` — which carries
				 * `container-type: inline-size`, making it a containing block for `position: fixed` — is
				 * exactly the trap that portal exists to escape.
				 */
			}
			<BasketTicketModal
				item={openTicketLine.value}
				onClose={() => {
					openTicketLine.value = null;
				}}
			/>
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
