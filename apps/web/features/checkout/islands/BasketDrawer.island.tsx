import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { useSignal } from "@preact/signals";
import { useCallback, useEffect, useRef } from "preact/hooks";
import "../styles/checkout.css";
import { Icon } from "@projective/ui/icons";
import { Drawer, Message } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { LocalKeys, readStored, removeStored, writeStored } from "@web/utils/storage-keys.ts";
import { readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import { type BasketPayload, BasketService } from "../core/BasketService.ts";
import { basketHref, isCheckoutPath, ownerKindOf } from "../core/basket-model.ts";
import {
	activeBasketId,
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
	endLineWrite,
	isSelected,
	owners as ownersSignal,
	promo as promoSignal,
	rememberedBasketId,
	resetAttempt,
	savedLines,
} from "../core/basket-state.ts";
import { devBasket, devOwners, devReadScope, isDevOwner } from "../core/dev-basket.ts";
import { Amount } from "../components/Amount.tsx";
import { BasketDrawerRow } from "../components/BasketDrawerRow.tsx";
import { BasketSwitcher } from "../components/BasketSwitcher.tsx";
import { NewListDialog } from "../components/NewListDialog.tsx";
import { GroupIcon } from "../components/checkout-glyphs.tsx";
import type { BasketItem, BasketOwnerSummary, BasketSummary } from "../types/checkout-types.ts";
import type { CheckoutResponse } from "../types/results.ts";

/**
 * BasketDrawer — the header Basket utility's right-side sliding drawer (DESIGN_SYSTEM Part D.1,
 * §B.10 overlay family).
 *
 * Three regions: the header is a {@link BasketSwitcher} over every account the buyer can buy for and
 * each one's baskets and lists; the body is the open basket grouped exactly as the server grouped it,
 * plus the saved-for-later shelf; the footer is the Drawer's pinned slot (§B.10.8) — totals, "View all
 * baskets" and "Proceed to Checkout" — so a long basket never scrolls its commitment away.
 *
 * **It is a peek, not a region.** It holds no money control of its own: "Proceed to Checkout" opens
 * step 1 of `/checkout` (Decision #70(k)), and Pay lives behind the flow, because a payment reachable
 * from a drawer that opens on every page is a payment reachable by accident.
 *
 * **Scope.** On the checkout routes the URL owns `?owner=` / `?basket=`, so switching navigates. Off
 * them the switcher's choice is a per-viewer preference (`LocalKeys.BASKET_OWNER`), cleared when the
 * shell's acting context changes.
 *
 * **Money rule.** Every figure is a server-computed `MoneyView` rendered through {@link Amount}, so it
 * carries `data-money-*` and follows a currency switch (Decision #70(D)). Nothing here sums, discounts,
 * converts or formats one.
 *
 * **Degradation.** A failed read renders the server's own sentence plus a Retry, and NEVER the empty
 * state: "your basket is empty" and "we could not read your basket" are opposite facts.
 */

// #region Props
/** Props for {@link BasketDrawer}. */
export interface BasketDrawerProps {
	/** Open state, owned by the header's Basket control. */
	open: Signal<boolean>;
	/**
	 * The acting account's basket scope (`personal` · `team:{id}` · …), derived from the hydrated
	 * `UserContext` by the shell. Seeded into the shared store only on a surface that does not own its
	 * own scope — `/checkout` resolves its scope from the URL, and a drawer overwriting that would
	 * silently re-point the page under the reader.
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
	const scenario = useSignal(readDevSeam()?.basketScenario);
	const createOpen = useSignal(false);
	const createName = useSignal("");
	const creating = useSignal(false);
	const shellOwner = useRef(owner);
	shellOwner.current = owner;

	/**
	 * The switcher's model: the owners read, with the OPEN owner's baskets taken from the latest basket
	 * read or write (whose `baskets` is that owner's, server-computed) so counts and subtotals never lag
	 * a write by a round trip. Before the owners read lands, the open owner alone.
	 */
	const switcherOwners = (): readonly BasketOwnerSummary[] => {
		const live = basketsSignal.value;
		const current = activeOwner.value;
		const real: readonly BasketOwnerSummary[] = ownersSignal.value.length > 0
			? ownersSignal.value
			: live.length > 0
			? [{
				owner: current,
				kind: ownerKindOf(current),
				name: "This account",
				avatar: null,
				baskets: [],
			}]
			: [];
		const fresh = real.map((entry) =>
			entry.owner === current && !isDevOwner(current) && live.length > 0
				? { ...entry, baskets: [...live] }
				: entry
		);
		return devOwners(fresh, scenario.value);
	};

	/**
	 * Re-read the basket for whatever scope is currently live, and the owners for the switcher.
	 *
	 * The outcome is recorded locally as well as folded into the shared store: `checkoutError` is
	 * shared with `/checkout`'s body, and a drawer that rendered it directly would show — or clear — an
	 * error that belonged to another region's write.
	 */
	const load = useCallback(async (): Promise<void> => {
		if (phase.value !== "ready") phase.value = "loading";
		const ctx = currentCheckoutContext();
		const [res, ownersRes] = await Promise.all([
			BasketService.get({ ...ctx, ...devReadScope(ctx.owner, ctx.basketId, ownersSignal.peek()) }),
			BasketService.owners(ctx),
		]);
		if (ownersRes.ok && ownersRes.data) ownersSignal.value = ownersRes.data;
		const listed = devOwners(ownersSignal.value, scenario.value)
			.find((entry) => entry.owner === ctx.owner);
		// A remembered owner the buyer can no longer buy for (they left the team) is dropped, and the
		// read repeats under the shell's own context rather than showing a basket no switcher row names.
		if (
			ownersRes.ok && !listed && ctx.owner !== shellOwner.current &&
			!isCheckoutPath(globalThis.location.pathname)
		) {
			removeStored("local", LocalKeys.BASKET_OWNER);
			activeOwner.value = shellOwner.current;
			activeBasketId.value = null;
			return load();
		}
		const asked = listed?.baskets.find((b) => b.id === ctx.basketId) ?? null;
		const landed = applyResponse(res, (data: BasketPayload) =>
			applyBasket({
				...data,
				basket: devBasket(data.basket, scenario.value, { ...ctx, summary: asked }),
			}));
		failure.value = landed ? null : (res.message ?? "We couldn't read your basket just now.");
		phase.value = landed ? "ready" : "error";
	}, []);

	// #region Scope and refresh wiring
	const lastOwner = useRef<string | null>(null);
	useEffect(() => {
		// `/checkout` owns its scope (it resolves `?owner=` server-side and seeds it itself). Everywhere
		// else the switcher's remembered choice wins, then the shell's context.
		const path = globalThis.location?.pathname ?? "";
		const onCheckout = isCheckoutPath(path);
		const first = lastOwner.current === null;
		const rescoped = !first && lastOwner.current !== owner;
		lastOwner.current = owner;

		if (!onCheckout && first) {
			const remembered = readStored("local", LocalKeys.BASKET_OWNER);
			activeOwner.value = remembered || owner;
			activeBasketId.value = remembered ? rememberedBasketId() : null;
		}

		/**
		 * A changed shell context re-scopes WHOSE money this is, which invalidates the composition
		 * wholesale: the chosen provider and card belong to the previous principal, the attempt key must
		 * not survive a change to what is being bought, and the switcher's remembered choice belonged to
		 * the previous context.
		 */
		if (rescoped && !onCheckout) {
			removeStored("local", LocalKeys.BASKET_OWNER);
			activeOwner.value = owner;
			activeBasketId.value = null;
			chosenProvider.value = null;
			chosenCardId.value = null;
			resetAttempt();
			void load();
		}

		/*
		 * Skip the read when a surface has already painted a basket into the store. On `/checkout` the
		 * page owns the scope: a page body seeds the store from an EFFECT, so this drawer hydrates first,
		 * sees `null`, and would ask for the DEFAULT basket — then its answer would land after the
		 * body's seed and overwrite it (measured: `?basket=bk-wishlist` replaced client-side by the
		 * default under a header still naming the wishlist).
		 */
		if (!rescoped && basketSignal.value === null && !onCheckout) void load();

		const onRefresh = () => void load();
		globalThis.addEventListener?.(BASKET_REFRESH_EVENT, onRefresh);
		const unsubscribe = subscribeDevSeam((seam) => {
			scenario.value = seam?.basketScenario;
			void load();
		});
		return () => {
			globalThis.removeEventListener?.(BASKET_REFRESH_EVENT, onRefresh);
			unsubscribe();
		};
	}, [owner, load]);

	// Opening always re-reads: the basket may have changed in another tab, and a stale peek at what is
	// about to be paid for is the one thing this surface must not show.
	useEffect(() => {
		if (open.value) void load();
	}, [open.value, load]);
	// #endregion

	// #region Switching
	/** Open another owner's basket or list. */
	const switchTo = (nextOwner: string, nextBasketId: string) => {
		if (isCheckoutPath(globalThis.location.pathname)) {
			globalThis.location.assign(basketHref(nextBasketId, nextOwner));
			return;
		}
		if (nextOwner !== activeOwner.value) {
			chosenProvider.value = null;
			chosenCardId.value = null;
			resetAttempt();
		}
		activeOwner.value = nextOwner;
		activeBasketId.value = nextBasketId;
		writeStored("local", LocalKeys.BASKET_OWNER, nextOwner);
		void load();
	};

	/** Create a list for the open owner, then open it. */
	const createList = async () => {
		const name = createName.value.trim();
		if (name === "" || creating.value) return;
		creating.value = true;
		const res = await BasketService.createList({ name }, currentCheckoutContext());
		creating.value = false;
		const created = res.ok ? res.data?.lists.activeId : null;
		if (!created) {
			failure.value = res.message ?? "We couldn't create that list just now.";
			return;
		}
		createOpen.value = false;
		createName.value = "";
		switchTo(activeOwner.value, created);
	};
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
	 * Lines the server's grouping did not claim. Normally empty — it exists because a line silently
	 * vanishing from a basket the buyer is about to pay for is a far worse answer than an extra heading.
	 */
	const ungrouped = lines.filter((line) => !grouped.has(line.id));

	const destinationsFor = (line: BasketItem): readonly BasketSummary[] =>
		basketsSignal.value.filter((entry) => entry.id !== line.basketId);

	const basketId = current?.id ?? null;
	const ownerParam = activeOwner.value;
	const selectedCount = current?.selectedCount ?? 0;
	const promo = promoSignal.value;
	const hasPromo = promo?.valid === true && promo.amount.minor > 0;
	const close = () => (open.value = false);
	const ownersModel = switcherOwners();

	const rowsOf = (rows: readonly BasketItem[]) =>
		rows.map((line) => (
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
		));
	// #endregion

	return (
		<Drawer
			visible={open}
			position="right"
			header={
				<span class="bskd__head">
					<span class="bskd__head-label">Basket</span>
					{ownersModel.length > 0
						? (
							<BasketSwitcher
								owners={ownersModel}
								owner={ownerParam}
								basketId={basketId}
								onSwitch={switchTo}
								onNewList={() => (createOpen.value = true)}
							/>
						)
						: null}
				</span>
			}
			class="shell-drawer"
			footer={current !== null && (lines.length > 0 || parked.length > 0)
				? (
					<div class="bskd__foot">
						<dl class="bskd__totals">
							<div class="bskd__total-row">
								<dt>Subtotal</dt>
								<dd>
									<Amount value={current.subtotal} hideOrigin />
								</dd>
							</div>
							{current.creatorDiscounts.minor > 0
								? (
									<div class="bskd__total-row">
										<dt>Creator discounts</dt>
										<dd>
											<Amount
												value={current.creatorDiscounts}
												sign="−"
												tone="credit"
												hideOrigin
											/>
										</dd>
									</div>
								)
								: null}
							<div class="bskd__total-row bskd__total-row--net">
								<dt>Total before fees</dt>
								<dd>
									<Amount value={current.net} size="lead" />
								</dd>
							</div>
						</dl>
						{
							/* `net` excludes the promo by definition (it is what the promo is applied
							   against), so the promo is a saving still to come, never a third row. */
						}
						{hasPromo
							? (
								<p class="bskd__note">
									{promo.label} takes a further{" "}
									<Amount value={promo.amount} tone="credit" hideOrigin /> off at checkout.
								</p>
							)
							: null}

						<div class="bskd__ctas">
							<a
								class="bskd__cta"
								href={basketHref(null, ownerParam)}
								onClick={close}
							>
								<Icon name="basket" size="sm" />
								<span>View all baskets</span>
							</a>
							<Button
								fluid
								rounded
								disabled={selectedCount === 0}
								aria-describedby={selectedCount === 0 ? "bskd-proceed-why" : undefined}
								icon={<Icon name="wallet" size="sm" />}
								label="Proceed to Checkout"
								onClick={() => {
									close();
									globalThis.location.href = basketHref(basketId, ownerParam);
								}}
							/>
						</div>
						{selectedCount === 0
							? (
								<p class="bskd__note" id="bskd-proceed-why" role="status">
									Nothing is ticked. Tick at least one item to take it through to checkout.
								</p>
							)
							: null}
					</div>
				)
				: null}
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
							<p class="bskd__empty-title">This basket is empty</p>
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
							<Amount class="bskd__group-total" value={group.subtotal} hideOrigin />
						</h3>
						<ul class="bskd__lines">{rowsOf(rows)}</ul>
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
							<ul class="bskd__lines">{rowsOf(ungrouped)}</ul>
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
							<ul class="bskd__lines">{rowsOf(parked)}</ul>
						</section>
					)
					: null}

				<p class="ui-visually-hidden" role="status" aria-live="polite">{notice.value}</p>
			</div>

			<NewListDialog
				visible={createOpen}
				name={createName}
				creating={creating.value}
				onCreate={() => void createList()}
			/>
		</Drawer>
	);
}
