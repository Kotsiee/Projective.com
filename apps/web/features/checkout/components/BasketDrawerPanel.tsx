import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { Icon } from "@projective/ui/icons";
import { Drawer, Message } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { LocalKeys, writeStored } from "@web/utils/storage-keys.ts";
import { type BasketPayload, BasketService } from "../core/BasketService.ts";
import { basketHref, isCheckoutPath, ownerKindOf } from "../core/basket-model.ts";
import {
	activeBasketId,
	activeLines,
	activeOwner,
	applyBasket,
	applyResponse,
	basket as basketSignal,
	baskets as basketsSignal,
	beginLineWrite,
	chosenCardId,
	chosenProvider,
	currentCheckoutContext,
	endLineWrite,
	isSelected,
	owners as ownersSignal,
	promo as promoSignal,
	resetAttempt,
	savedLines,
} from "../core/basket-state.ts";
import { devOwners, isDevOwner } from "../core/dev-basket.ts";
import type { BasketDrawerScope } from "../core/useBasketDrawerScope.ts";
import { BasketDrawerRow } from "./BasketDrawerRow.tsx";
import { BasketDrawerGroup } from "./BasketDrawerGroup.tsx";
import { BasketDrawerSkeleton } from "./BasketDrawerSkeleton.tsx";
import { BasketDrawerFooter } from "./BasketDrawerFooter.tsx";
import { BasketSwitcher } from "./BasketSwitcher.tsx";
import { GroupIcon } from "./checkout-glyphs.tsx";
import type { BasketItem, BasketOwnerSummary, BasketSummary } from "../types/checkout-types.ts";
import type { CheckoutResponse } from "../types/results.ts";

// #region Props
/** Props for {@link BasketDrawerPanel}. */
export interface BasketDrawerPanelProps {
	/** Open state, owned by the header's Basket control. */
	open: Signal<boolean>;
	/** The data half the always-mounted host runs. */
	scope: BasketDrawerScope;
}
// #endregion

/**
 * BasketDrawerPanel — the header Basket utility's right-side drawer (DESIGN_SYSTEM §D.1, §B.10),
 * loaded lazily by the `BasketDrawer` host.
 *
 * Three regions: the **header** holds the title and a {@link BasketSwitcher} over every account the
 * buyer can buy for and each one's baskets and lists — its "New list" opens an anchored popover, never
 * a second scrim over the drawer; the **body** is the open basket grouped exactly as the server
 * grouped it, plus the saved-for-later shelf, with `shimmer` placeholders of the rows' own height while
 * a read or a list switch is in flight; the **footer** is the Drawer's pinned slot — totals, View all
 * baskets and Proceed to Checkout — so a long basket never scrolls its commitment away.
 *
 * **It is a peek, not a region.** It holds no money control of its own: Proceed to Checkout opens step
 * 1 of `/checkout` (Decision #70(k)). On the checkout routes the URL owns `?owner=` / `?basket=`, so
 * switching navigates; off them the choice is remembered per viewer.
 *
 * **Degradation.** A failed read renders the server's own sentence and Try again, and NEVER the empty
 * state: "your basket is empty" and "we could not read your basket" are opposite facts.
 */
export function BasketDrawerPanel(props: BasketDrawerPanelProps): JSX.Element {
	const { open, scope } = props;
	const { phase, failure, scenario, load } = scope;
	const notice = useSignal("");
	const switching = useSignal(false);

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

	// #region Switching
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
		switching.value = true;
		void load().finally(() => (switching.value = false));
	};

	const createList = async (name: string): Promise<string | null> => {
		const res = await BasketService.createList({ name }, currentCheckoutContext());
		const created = res.ok ? res.data?.lists.activeId : null;
		if (!created) return res.message ?? "We couldn't create that list just now.";
		switchTo(activeOwner.value, created);
		return null;
	};
	// #endregion

	// #region Line writes
	const write = async (lineId: string, run: () => Promise<CheckoutResponse<BasketPayload>>) => {
		beginLineWrite(lineId);
		const res = await run();
		const landed = applyResponse(res, applyBasket);
		failure.value = landed ? null : (res.message ?? "That change could not be saved.");
		notice.value = landed ? (res.message ?? "Basket updated.") : "";
		endLineWrite(lineId);
	};

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
		void write(
			line.id,
			() => BasketService.moveItem({ basketItemId: line.id, toBasketId }, currentCheckoutContext()),
		);

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
	const ungrouped = lines.filter((line) => !grouped.has(line.id));

	const destinationsFor = (line: BasketItem): readonly BasketSummary[] =>
		basketsSignal.value.filter((entry) => entry.id !== line.basketId);

	const close = () => (open.value = false);
	const ownersModel = switcherOwners();
	const pending = switching.value || (phase.value === "loading" && current === null);
	const empty = !pending && current !== null && lines.length === 0 && parked.length === 0;

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
								owner={activeOwner.value}
								basketId={current?.id ?? null}
								onSwitch={switchTo}
								onCreateList={createList}
							/>
						)
						: null}
				</span>
			}
			class="shell-drawer bskd-drawer"
			footer={!pending && current !== null && (lines.length > 0 || parked.length > 0)
				? (
					<BasketDrawerFooter
						basket={current}
						ownerParam={activeOwner.value}
						promo={promoSignal.value}
						onClose={close}
					/>
				)
				: null}
		>
			<div class="bskd" aria-busy={pending ? "true" : undefined}>
				{failure.value
					? (
						<Message severity="danger" class="bskd__error">
							<span class="bskd__error-text">{failure.value}</span>
							<Button
								variant="outlined"
								severity="neutral"
								size="sm"
								icon={<Icon name="refresh" size="sm" />}
								label="Try again"
								onClick={() => void load()}
							/>
						</Message>
					)
					: null}

				{pending ? <BasketDrawerSkeleton /> : null}

				{empty
					? (
						<div class="bskd__empty" role="status">
							<Icon name="basket" size="xl" />
							<p class="bskd__empty-title">This basket is empty</p>
							<p class="bskd__empty-note">
								Anything you add from a listing lands here, ready to pay for together.
							</p>
							<a
								class="ui-button ui-button--neutral ui-button--outlined ui-button--size-md bskd__empty-cta"
								href="/explore"
								onClick={close}
							>
								<span class="ui-button__label">Browse Explore</span>
							</a>
						</div>
					)
					: null}

				{pending ? null : (
					<>
						{groups.map(({ group, rows }) => (
							<BasketDrawerGroup
								key={group.id}
								id={group.id}
								icon={<GroupIcon group={group.group} />}
								label={group.label}
								caption={group.caption}
								total={group.subtotal}
							>
								{rowsOf(rows)}
							</BasketDrawerGroup>
						))}

						{ungrouped.length > 0
							? (
								<BasketDrawerGroup id="other" icon={<Icon name="basket" />} label="Other items">
									{rowsOf(ungrouped)}
								</BasketDrawerGroup>
							)
							: null}

						{parked.length > 0
							? (
								<BasketDrawerGroup
									id="saved"
									icon={<Icon name="bookmark" />}
									label="Saved for later"
									caption="Not part of the next payment"
									saved
								>
									{rowsOf(parked)}
								</BasketDrawerGroup>
							)
							: null}
					</>
				)}

				<p class="ui-visually-hidden" role="status" aria-live="polite">{notice.value}</p>
			</div>
		</Drawer>
	);
}
