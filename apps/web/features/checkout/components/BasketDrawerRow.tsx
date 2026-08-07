import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Icon } from "@projective/ui/icons";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { itemHref, itemKindLabel, sellerHref } from "../core/basket-model.ts";
import { isSelected, pendingLines } from "../core/basket-state.ts";
import { groupIconName } from "./checkout-glyphs.tsx";
import { itemKindMeta } from "@projective/types/finance";
import type { BasketItem, BasketSummary } from "../types/checkout-types.ts";

/**
 * BasketDrawerRow — one line of the header basket drawer.
 *
 * Every control is icon-only with a portal `Tooltip` and an `aria-label` (DESIGN_SYSTEM §B.6): the
 * drawer is a peek at ~25rem, and four labelled buttons per row would leave no room for the fact the
 * row exists to state. The row's own status — unavailable, parked, mid-write — is iconographic for the
 * same reason, with the words in the tooltip.
 *
 * **No figure on this row is computed here.** `lineTotal` and `originalPrice` are server-formatted
 * `MoneyView`s printed through their `display` string; the row never multiplies a unit price by a
 * quantity, because that is the second arithmetic path a money surface cannot afford.
 */

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

export function BasketDrawerRow(props: BasketDrawerRowProps): JSX.Element {
	const { line, destinations, onToggleSelected, onPark, onMove, onRemove, onNavigate } = props;
	const moveOpen = useSignal(false);
	const moveBtn = useRef<HTMLButtonElement>(null);

	const busy = pendingLines.value.has(line.id);
	const parked = line.savedForLater;
	const selected = isSelected(line);
	const seller = sellerHref(line);
	const kindLabel = itemKindLabel(line);
	const parkLabel = parked
		? `Move ${line.title} back to the basket`
		: `Save ${line.title} for later`;

	return (
		<li
			class="bskd-line"
			data-busy={busy ? "true" : undefined}
			data-parked={parked ? "true" : undefined}
		>
			{
				/*
			  A parked line has no checkbox: parking and queueing for payment are exclusive by definition
			  server-side (`updateItem` clears `selected` whenever it parks), so a checkbox here would be
			  a control that silently un-does itself.
			*/
			}
			{parked ? <span class="bskd-line__spacer" aria-hidden="true" /> : (
				<input
					type="checkbox"
					class="bskd-line__check"
					checked={selected}
					disabled={!line.available || busy}
					aria-label={`Include ${line.title} in the next checkout`}
					onChange={() => onToggleSelected(line)}
				/>
			)}

			<a class="bskd-line__link" href={itemHref(line)} onClick={onNavigate}>
				<span class="bskd-line__thumb">
					{line.thumbnail
						? <img src={line.thumbnail} alt="" loading="lazy" decoding="async" />
						: <Icon name={groupIconName(itemKindMeta(line.itemType).group)} size="md" />}
				</span>
				<span class="bskd-line__body">
					<span class="bskd-line__title">{line.title}</span>
					<span class="bskd-line__meta">
						<span class="bskd-line__kind">{line.subtitle ?? kindLabel}</span>
						{line.quantity > 1 ? <span class="bskd-line__qty">×{line.quantity}</span> : null}
					</span>
				</span>
			</a>

			<span class="bskd-line__prices">
				<span class="bskd-line__price">{line.lineTotal.display}</span>
				{line.originalPrice
					? (
						<s class="bskd-line__was">
							<span class="ui-visually-hidden">Was</span>
							{line.originalPrice.display}
						</s>
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

				{
					/*
				  An unavailable line states itself with a glyph and puts the words in the tooltip and the
				  label (§B.6): a 27rem panel has no room for a sentence per row, and the reason is exactly
				  as reachable either way.
				*/
				}
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

			<span class="bskd-line__actions">
				<Tooltip content={parked ? "Move back to basket" : "Save for later"} placement="top">
					<button
						type="button"
						class="bskd-line__btn"
						aria-label={parkLabel}
						aria-pressed={parked}
						disabled={busy}
						onClick={() => onPark(line, !parked)}
					>
						<Icon name={parked ? "basket" : "bookmark"} size="sm" />
					</button>
				</Tooltip>

				{destinations.length > 0
					? (
						<>
							<Tooltip content="Move to another list" placement="top">
								<button
									ref={moveBtn}
									type="button"
									class="bskd-line__btn"
									aria-label={`Move ${line.title} to another list`}
									aria-haspopup="menu"
									aria-expanded={moveOpen.value ? "true" : "false"}
									disabled={busy}
								>
									<Icon name="folder" size="sm" />
								</button>
							</Tooltip>
							<Popover
								open={moveOpen}
								targetRef={moveBtn}
								placement="bottom-end"
								class="bskd-menu"
							>
								<ul class="bskd-menu__list" role="menu" aria-label="Move to another list">
									{destinations.map((dest) => (
										<li key={dest.id} role="none">
											<button
												type="button"
												role="menuitem"
												class="bskd-menu__item"
												onClick={() => {
													moveOpen.value = false;
													onMove(line, dest.id);
												}}
											>
												<Icon name="folder" size="sm" />
												<span class="bskd-menu__label">{dest.name}</span>
											</button>
										</li>
									))}
								</ul>
							</Popover>
						</>
					)
					: null}

				<Tooltip content="Remove" placement="top">
					<button
						type="button"
						class="bskd-line__btn bskd-line__btn--danger"
						aria-label={`Remove ${line.title} from the basket`}
						disabled={busy}
						onClick={() => onRemove(line)}
					>
						<Icon name="trash" size="sm" />
					</button>
				</Tooltip>
			</span>
		</li>
	);
}
