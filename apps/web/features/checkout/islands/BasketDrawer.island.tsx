import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { useSignal } from "@preact/signals";
import { useCallback, useEffect } from "preact/hooks";
import "../styles/checkout.css";
import { Icon } from "@projective/ui/icons";
import { Drawer, Message } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import { type BasketPayload, BasketService } from "../core/BasketService.ts";
import { basketHref, checkoutHref, isCheckoutPath } from "../core/basket-model.ts";
import { checkoutSim } from "../core/checkout-seam.ts";
import {
	activeLines,
	activeOwner,
	applyBasket,
	applyResponse,
	basket as basketSignal,
	BASKET_REFRESH_EVENT,
	baskets as basketsSignal,
	beginLineWrite,
	chosenCardId,
	chosenProvider,
	currentCheckoutContext,
	devSim,
	endLineWrite,
	isSelected,
	promo as promoSignal,
	resetAttempt,
	savedLines,
} from "../core/basket-state.ts";
import { BasketDrawerRow } from "../components/BasketDrawerRow.tsx";
import { GroupIcon } from "../components/checkout-glyphs.tsx";
import type { BasketItem, BasketSummary } from "../types/checkout-types.ts";
import type { CheckoutResponse } from "../types/results.ts";

/**
 * BasketDrawer — the header Basket utility's right-side sliding drawer (DESIGN_SYSTEM Part D.1).
 *
 * It replaces the inline `nav-fixtures` list that used to live in `UserActions`, which drew three
 * hard-coded rows with hard-coded prices and no relationship to anything the buyer could pay for. This
 * one reads the REAL basket through the thin {@link BasketService}, groups it exactly as the server
 * grouped it, and hands off to the two surfaces that can act on it.
 *
 * **It is a peek, not a region.** The four-region contract (lane · header band · footer band · body)
 * governs the `/basket` middle-nav surface; this is a header overlay, so it deliberately carries both
 * the facts and the two navigations — but it still holds no primary money control of its own. Pay lives
 * on `/checkout`, behind an explicit step, because a payment reachable from a drawer that opens on
 * every page is a payment reachable by accident.
 *
 * **Money rule.** Every figure below is a server-computed `MoneyView` printed through its `display`
 * string. Nothing here sums, discounts, converts or formats one — including the group subtotals, which
 * the server resolved alongside the groups themselves.
 *
 * **Degradation.** A failed read renders the server's own sentence plus a Retry, and NEVER the empty
 * state: "your basket is empty" and "we could not read your basket" are opposite facts, and showing the
 * first for the second is how a buyer concludes their selection was lost and re-adds everything.
 */

// #region Props
/** Props for {@link BasketDrawer}. */
export interface BasketDrawerProps {
	/** Open state, owned by the header's Basket control. */
	open: Signal<boolean>;
	/**
	 * The acting account's basket scope (`personal` · `team:{id}` · …), derived from the hydrated
	 * `UserContext` by the shell. Seeded into the shared store only on a surface that does not own its
	 * own scope — `/basket` and `/checkout` resolve theirs from the URL, and a drawer overwriting that
	 * would silently re-point the page under the reader.
	 */
	owner: string;
}
// #endregion

/** How the drawer's own read is going — distinct from whether the basket happens to be empty. */
type LoadPhase = "idle" | "loading" | "ready" | "error";

export default function BasketDrawer(props: BasketDrawerProps): JSX.Element {
	const { open, owner } = props;
	const phase = useSignal<LoadPhase>("idle");
	const failure = useSignal<string | null>(null);
	const notice = useSignal<string>("");

	/**
	 * Re-read the basket for whatever scope is currently live.
	 *
	 * The outcome is recorded locally as well as folded into the shared store: `checkoutError` is
	 * shared with `/basket`'s body, and a drawer that rendered it directly would show — or clear — an
	 * error that belonged to another region's write.
	 */
	const load = useCallback(async () => {
		if (phase.value !== "ready") phase.value = "loading";
		const res = await BasketService.get(currentCheckoutContext());
		const landed = applyResponse(res, applyBasket);
		failure.value = landed ? null : (res.message ?? "We couldn't read your basket just now.");
		phase.value = landed ? "ready" : "error";
	}, []);

	// #region Scope, simulation and refresh wiring
	useEffect(() => {
		// Mirror the dev seam so the first read already carries the simulated axes; inert in production.
		devSim.value = checkoutSim(readDevSeam());

		// `/basket` and `/checkout` own their scope (they resolve `?owner=` server-side and seed it
		// themselves). Everywhere else the shell's context is the only scope there is.
		const path = globalThis.location?.pathname ?? "";
		if (!isCheckoutPath(path) && owner) activeOwner.value = owner;

		/*
		 * Skip the read when a surface has already painted a basket into the store — the header dot and
		 * the page body would otherwise both ask for the same thing on every navigation.
		 *
		 * The `isCheckoutPath` half of that guard is load-bearing, not belt-and-braces. Emptiness alone
		 * cannot decide it: a page body seeds the store from an EFFECT, so on `/basket` this drawer
		 * hydrates first, sees `null`, and asks for the acting account's DEFAULT basket — then its answer
		 * lands after the body's seed and overwrites it. Measured before the guard:
		 * `/basket?basket=bk-wishlist` SSR'd the wishlist and was replaced client-side by the default
		 * basket, under a header band still naming the wishlist. On those two routes the page owns the
		 * scope (the comment above already says so), so the drawer reads what the page published instead
		 * of racing it for a different answer.
		 */
		if (basketSignal.value === null && !isCheckoutPath(path)) void load();

		/**
		 * A persona flip re-scopes WHOSE money this is, which invalidates the composition wholesale: the
		 * chosen provider and card belong to the previous principal, and the attempt key must not
		 * survive a change to what is being bought (the SSOT's own rule). The basket id is deliberately
		 * left alone — the fat service resolves a foreign id to the new scope's default basket, so
		 * clearing it here would only race the page body for the same answer.
		 */
		const stopSeam = subscribeDevSeam((seam) => {
			devSim.value = checkoutSim(seam);
			chosenProvider.value = null;
			chosenCardId.value = null;
			resetAttempt();
			void load();
		});

		const onRefresh = () => void load();
		globalThis.addEventListener?.(BASKET_REFRESH_EVENT, onRefresh);
		return () => {
			stopSeam();
			globalThis.removeEventListener?.(BASKET_REFRESH_EVENT, onRefresh);
		};
	}, [owner, load]);

	// Opening always re-reads: the basket may have changed in another tab, and a stale peek at what is
	// about to be paid for is the one thing this surface must not show.
	useEffect(() => {
		if (open.value) void load();
	}, [open.value, load]);
	// #endregion

	// #region Line writes
	const write = useCallback(
		async (lineId: string, run: () => Promise<CheckoutResponse<BasketPayload>>) => {
			beginLineWrite(lineId);
			const res = await run();
			const landed = applyResponse(res, applyBasket);
			failure.value = landed ? null : (res.message ?? "That change could not be saved.");
			notice.value = landed ? (res.message ?? "Basket updated.") : "";
			endLineWrite(lineId);
		},
		[],
	);

	const toggleSelected = (line: BasketItem) => {
		const next = !isSelected(line);
		beginLineWrite(line.id, next);
		void (async () => {
			const res = await BasketService.updateItem(
				{ basketItemId: line.id, isSelectedForCheckout: next },
				currentCheckoutContext(),
			);
			const landed = applyResponse(res, applyBasket);
			failure.value = landed ? null : (res.message ?? "That change could not be saved.");
			endLineWrite(line.id);
		})();
	};

	const park = (line: BasketItem, parked: boolean) =>
		void write(line.id, () =>
			BasketService.updateItem(
				{ basketItemId: line.id, savedForLater: parked },
				currentCheckoutContext(),
			));

	const move = (line: BasketItem, toBasketId: string) =>
		void write(line.id, () =>
			BasketService.moveItem(
				{ basketItemId: line.id, toBasketId },
				currentCheckoutContext(),
			));

	const remove = (line: BasketItem) =>
		void write(
			line.id,
			() => BasketService.removeItem({ basketItemId: line.id }, currentCheckoutContext()),
		);
	// #endregion

	// #region Derived view
	const current = basketSignal.value;
	const lines = activeLines.value;
	const parked = savedLines.value;
	const byId = new Map<string, BasketItem>(lines.map((line) => [line.id, line]));
	const grouped = new Set<string>();
	const groups = (current?.groups ?? []).map((group) => {
		const rows = group.itemIds.map((id) => byId.get(id)).filter((row): row is BasketItem =>
			row !== undefined
		);
		for (const row of rows) grouped.add(row.id);
		return { group, rows };
	}).filter((entry) => entry.rows.length > 0);

	/**
	 * Lines the server's grouping did not claim.
	 *
	 * `buildGroups` covers every active line today, so this is normally empty — it exists because the
	 * alternative failure mode is a line silently vanishing from a basket the buyer is about to pay
	 * for, and an unexpected extra heading is a far cheaper wrong answer than a missing charge.
	 */
	const ungrouped = lines.filter((line) => !grouped.has(line.id));

	const destinationsFor = (line: BasketItem): readonly BasketSummary[] =>
		basketsSignal.value.filter((entry) => entry.id !== line.basketId);

	const basketId = current?.id ?? null;
	const ownerParam = activeOwner.value;
	const selectedCount = current?.selectedCount ?? 0;
	const close = () => (open.value = false);
	// #endregion

	return (
		<Drawer
			visible={open}
			position="right"
			header={current?.name ? `Basket · ${current.name}` : "Basket"}
			class="shell-drawer"
			size="min(27rem, 94vw)"
		>
			<div class="bskd">
				{failure.value
					? (
						<Message severity="danger" class="bskd__error">
							<span class="bskd__error-text">{failure.value}</span>
							<button
								type="button"
								class="bskd__retry"
								onClick={() => void load()}
							>
								<Icon name="refresh" size="sm" />
								<span>Try again</span>
							</button>
						</Message>
					)
					: null}

				{phase.value === "loading" && current === null
					? (
						<p class="bskd__pending" role="status">
							<Icon name="hourglass" size="md" />
							<span>Reading your basket…</span>
						</p>
					)
					: null}

				{
					/*
				  The empty state is shown only once a read has actually LANDED. While one is in flight,
				  or after one failed, "your basket is empty" would be an assertion the surface has no
				  evidence for.
				*/
				}
				{current !== null && lines.length === 0 && parked.length === 0
					? (
						<div class="bskd__empty" role="status">
							<Icon name="basket" size="xl" />
							<p class="bskd__empty-title">Your basket is empty</p>
							<p class="bskd__empty-note">
								Anything you add from a listing lands here, ready to pay for together.
							</p>
							<a class="bskd__empty-cta" href="/explore" onClick={close}>Browse Explore</a>
						</div>
					)
					: null}

				{groups.map(({ group, rows }) => (
					<section key={group.id} class="bskd__group" aria-labelledby={`bskd-g-${group.id}`}>
						<h3 class="bskd__group-head" id={`bskd-g-${group.id}`}>
							<span class="bskd__group-icon" aria-hidden="true">
								<GroupIcon group={group.group} />
							</span>
							<span class="bskd__group-text">
								<span class="bskd__group-label">{group.label}</span>
								{group.caption ? <span class="bskd__group-caption">{group.caption}</span> : null}
							</span>
							{/* The server's group subtotal, printed verbatim. */}
							<span class="bskd__group-total">{group.subtotal.display}</span>
						</h3>
						<ul class="bskd__lines">
							{rows.map((line) => (
								<BasketDrawerRow
									key={line.id}
									line={line}
									destinations={destinationsFor(line)}
									onToggleSelected={toggleSelected}
									onPark={park}
									onMove={move}
									onRemove={remove}
									onNavigate={close}
								/>
							))}
						</ul>
					</section>
				))}

				{ungrouped.length > 0
					? (
						<section class="bskd__group" aria-labelledby="bskd-g-other">
							<h3 class="bskd__group-head" id="bskd-g-other">
								<span class="bskd__group-icon" aria-hidden="true">
									<Icon name="basket" />
								</span>
								<span class="bskd__group-text">
									<span class="bskd__group-label">Other items</span>
								</span>
							</h3>
							<ul class="bskd__lines">
								{ungrouped.map((line) => (
									<BasketDrawerRow
										key={line.id}
										line={line}
										destinations={destinationsFor(line)}
										onToggleSelected={toggleSelected}
										onPark={park}
										onMove={move}
										onRemove={remove}
										onNavigate={close}
									/>
								))}
							</ul>
						</section>
					)
					: null}

				{parked.length > 0
					? (
						<section class="bskd__group bskd__group--saved" aria-labelledby="bskd-g-saved">
							<h3 class="bskd__group-head" id="bskd-g-saved">
								<span class="bskd__group-icon" aria-hidden="true">
									<Icon name="bookmark" />
								</span>
								<span class="bskd__group-text">
									<span class="bskd__group-label">Saved for later</span>
									<span class="bskd__group-caption">Not part of the next payment</span>
								</span>
							</h3>
							<ul class="bskd__lines">
								{parked.map((line) => (
									<BasketDrawerRow
										key={line.id}
										line={line}
										destinations={destinationsFor(line)}
										onToggleSelected={toggleSelected}
										onPark={park}
										onMove={move}
										onRemove={remove}
										onNavigate={close}
									/>
								))}
							</ul>
						</section>
					)
					: null}

				<p class="ui-visually-hidden" role="status" aria-live="polite">{notice.value}</p>
			</div>

			{current !== null && (lines.length > 0 || parked.length > 0)
				? (
					<div class="bskd__foot">
						<dl class="bskd__totals">
							<div class="bskd__total-row">
								<dt>Subtotal</dt>
								<dd>{current.subtotal.display}</dd>
							</div>
							{current.creatorDiscounts.minor > 0
								? (
									<div class="bskd__total-row">
										<dt>Creator discounts</dt>
										<dd>−{current.creatorDiscounts.display}</dd>
									</div>
								)
								: null}
							{promoSignal.value?.valid
								? (
									<div class="bskd__total-row">
										<dt>{promoSignal.value.label}</dt>
										<dd>−{promoSignal.value.amount.display}</dd>
									</div>
								)
								: null}
							<div class="bskd__total-row bskd__total-row--net">
								<dt>Total before fees</dt>
								<dd>{current.net.display}</dd>
							</div>
						</dl>

						<div class="bskd__ctas">
							<a
								class="bskd__cta"
								href={basketHref(basketId, ownerParam)}
								onClick={close}
							>
								<Icon name="basket" size="sm" />
								<span>Go to Basket</span>
							</a>
							<Button
								fluid
								rounded
								disabled={selectedCount === 0}
								icon={<Icon name="wallet" size="sm" />}
								label="Proceed to Checkout"
								onClick={() => {
									close();
									globalThis.location.href = checkoutHref(basketId, ownerParam);
								}}
							/>
						</div>
						{selectedCount === 0
							? (
								<p class="bskd__note" role="status">
									Tick at least one item to take it through to checkout.
								</p>
							)
							: null}
					</div>
				)
				: null}
		</Drawer>
	);
}
