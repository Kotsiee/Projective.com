import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Icon } from "@projective/ui/icons";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { Button, Checkbox } from "@projective/ui/fields";
import { ProgressiveImage } from "@projective/ui/display";
import { AspectRatio } from "@projective/ui/layout";
import { fundingNote, itemHref, itemKindLabel, sellerHref } from "../core/basket-model.ts";
import { Amount } from "./Amount.tsx";
import { isSelected, pendingLines } from "../core/basket-state.ts";
import { groupIconName } from "./checkout-glyphs.tsx";
import { itemKindMeta } from "@projective/types/finance";
import type { BasketItem, BasketSummary } from "../types/checkout-types.ts";

// #region Props
/** Props for {@link BasketDrawerRow}. */
export interface BasketDrawerRowProps {
	/** The line to draw. */
	line: BasketItem;
	/** The account's OTHER baskets — a move destination list that never includes this line's own. */
	destinations: readonly BasketSummary[];
	/** Include/exclude this line from the next checkout. */
	onToggleSelected: (line: BasketItem) => void;
	/** Park the line onto the saved-for-later shelf, or bring it back. */
	onPark: (line: BasketItem, parked: boolean) => void;
	/** Move the line into another of the account's baskets. */
	onMove: (line: BasketItem, toBasketId: string) => void;
	/** Remove the line outright (soft server-side — the row is stamped, never destroyed). */
	onRemove: (line: BasketItem) => void;
	/** Called before the row navigates away, so the drawer closes rather than staying open behind it. */
	onNavigate: () => void;
}
// #endregion

/**
 * BasketDrawerRow — one line of the header basket drawer, separated from the next by one hairline and
 * never boxed (§B.9).
 *
 * The checkbox sits level with a 1:1 `AspectRatio` thumbnail — a `ProgressiveImage` whose missing or
 * broken picture falls back to the line kind's glyph on the solid `--surface-2` ground. A parked line
 * has no checkbox: parking and queueing for payment are exclusive server-side, so a checkbox there
 * would silently undo itself. Every row action is an icon-only text `Button` behind a portal `Tooltip`
 * with an `aria-label` (§B.8.5), because the drawer is a peek at `--drawer-w` and four worded buttons
 * per row would crowd out the fact the row states. An unavailable line says so with a glyph, the
 * reason in its tooltip and label.
 *
 * **No figure on this row is computed here.** `lineTotal` and `originalPrice` are server-computed
 * `MoneyView`s rendered through {@link Amount}, so they follow a currency switch. A ticket or session
 * line says what paying does with the money ({@link fundingNote}) as unboxed Meta-register text.
 */
export function BasketDrawerRow(props: BasketDrawerRowProps): JSX.Element {
	const { line, destinations, onToggleSelected, onPark, onMove, onRemove, onNavigate } = props;
	const moveOpen = useSignal(false);

	const busy = pendingLines.value.has(line.id);
	const parked = line.savedForLater;
	const selected = isSelected(line);
	const ticked = useSignal(selected);
	useEffect(() => {
		ticked.value = selected;
	}, [selected]);

	const seller = sellerHref(line);
	const kindLabel = itemKindLabel(line);
	const funding = fundingNote(line);
	const parkLabel = parked
		? `Move ${line.title} back to the basket`
		: `Save ${line.title} for later`;

	return (
		<li
			class="bskd-line"
			data-busy={busy ? "true" : undefined}
			data-parked={parked ? "true" : undefined}
		>
			{parked
				? <span class="bskd-line__spacer" aria-hidden="true" />
				: (
					<span class="bskd-line__check">
						<Checkbox
							size="sm"
							value={ticked}
							disabled={!line.available || busy}
							aria-label={`Include ${line.title} in the next checkout`}
							onValueChange={() => onToggleSelected(line)}
						/>
					</span>
				)}

			<a class="bskd-line__link" href={itemHref(line)} onClick={onNavigate}>
				<AspectRatio ratio="square" class="bskd-line__thumb">
					<ProgressiveImage
						src={line.thumbnail}
						loading="lazy"
						fallback={<Icon name={groupIconName(itemKindMeta(line.itemType).group)} size="md" />}
					/>
				</AspectRatio>
				<span class="bskd-line__body">
					<span class="bskd-line__title">{line.title}</span>
					<span class="bskd-line__meta">
						<span class="bskd-line__kind">{line.subtitle ?? kindLabel}</span>
						{line.quantity > 1 ? <span class="bskd-line__qty">×{line.quantity}</span> : null}
					</span>
				</span>
			</a>

			<span class="bskd-line__prices">
				<Amount class="bskd-line__price" value={line.lineTotal} hideOrigin />
				{line.originalPrice
					? (
						<Amount
							class="bskd-line__was"
							value={line.originalPrice}
							size="micro"
							tone="struck"
							srLabel="Was"
							hideOrigin
						/>
					)
					: null}
			</span>

			<span class="bskd-line__sub">
				{seller && line.sellerName
					? (
						<a class="bskd-line__seller" href={seller} onClick={onNavigate}>
							{line.sellerName}
						</a>
					)
					: null}
				{!line.available
					? (
						<Tooltip
							content={line.unavailableReason ?? "This is no longer available."}
							placement="top"
						>
							<span
								class="bskd-line__flag"
								role="status"
								aria-label={line.unavailableReason ?? `${line.title} is no longer available`}
							>
								<Icon name="warning" size="sm" />
							</span>
						</Tooltip>
					)
					: null}
			</span>

			{funding ? <p class="bskd-line__funding">{funding}</p> : null}

			<span class="bskd-line__actions">
				<Tooltip content={parked ? "Move back to basket" : "Save for later"} placement="top">
					<Button
						variant="text"
						severity="secondary"
						size="sm"
						iconOnly
						class="bskd-line__btn"
						icon={<Icon name={parked ? "basket" : "bookmark"} size="sm" />}
						aria-label={parkLabel}
						aria-pressed={parked}
						disabled={busy}
						onClick={() => onPark(line, !parked)}
					/>
				</Tooltip>

				{destinations.length > 0
					? (
						<Popover
							open={moveOpen}
							placement="bottom-end"
							class="bskd-menu"
							trigger={(api) => (
								<Tooltip content="Move to another list" placement="top">
									<Button
										variant="text"
										severity="secondary"
										size="sm"
										iconOnly
										class="bskd-line__btn"
										triggerRef={api.ref}
										icon={<Icon name="folder" size="sm" />}
										aria-label={`Move ${line.title} to another list`}
										aria-haspopup="menu"
										aria-expanded={api.expanded ? "true" : "false"}
										aria-controls={api.panelId}
										disabled={busy}
										onClick={api.toggle}
									/>
								</Tooltip>
							)}
						>
							<ul class="bskd-menu__list" role="menu" aria-label="Move to another list">
								{destinations.map((dest) => (
									<li key={dest.id} role="none">
										<button
											type="button"
											role="menuitem"
											class="ui-menu-item bskd-menu__item"
											onClick={() => {
												moveOpen.value = false;
												onMove(line, dest.id);
											}}
										>
											<Icon name="folder" size="sm" class="ui-menu-item__icon" />
											<span class="bskd-menu__label">{dest.name}</span>
										</button>
									</li>
								))}
							</ul>
						</Popover>
					)
					: null}

				<Tooltip content="Remove" placement="top">
					<Button
						variant="text"
						severity="secondary"
						size="sm"
						iconOnly
						class="bskd-line__btn bskd-line__btn--danger"
						icon={<Icon name="trash" size="sm" />}
						aria-label={`Remove ${line.title} from the basket`}
						disabled={busy}
						onClick={() => onRemove(line)}
					/>
				</Tooltip>
			</span>
		</li>
	);
}
