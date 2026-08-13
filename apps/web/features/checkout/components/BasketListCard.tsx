import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { Button } from "@projective/ui/fields";
import { Popover } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { Amount } from "./Amount.tsx";
import { RemoveAction } from "./LineAction.tsx";
import { groupNoun } from "./BasketGroupSection.tsx";
import { groupIconName } from "./checkout-glyphs.tsx";
import { itemHref } from "../core/basket-model.ts";
import { itemKindMeta } from "@projective/types/finance";
import type { BasketItem, BasketSummary } from "../types/checkout-types.ts";

/**
 * BasketListCard — one line as it appears on a SHELF rather than in a basket.
 *
 * The parked "Saved for later" shelf and a non-default named list are browsed, not checked out: there
 * is no selection checkbox to tick, no quantity to settle and no total for the line to contribute to.
 * What a reader does there is move a line somewhere it can be bought, or let it go.
 *
 * It is a second PRESENTATION, not a second row component: `BasketRow` remains the one renderer of a
 * checkout-eligible line, with its selection, quantity, kind facts, delivery address and full price
 * block. Reproducing those here would be a second place for a fact to be forgotten.
 *
 * ## Why the moves are three named controls rather than one control and a kebab
 *
 * A shelf card is wide — a 16:9 cover, then the identity beneath it — so there is room to NAME every
 * move a shelf actually needs instead of hiding two of them behind an icon a reader has to open to
 * discover. **Move to Basket** is the one bordered control, because it is the only move that changes
 * what the buyer is about to pay for; **Remove** and **Add to List** are quiet text actions in the
 * package's own button vocabulary. The line's price sits at the inline-END of the same row as Move to
 * Basket, so the figure and the control that acts on it are read together.
 *
 * **Add to List is ABSENT, not disabled, when there is nowhere to move to.** A disabled control
 * advertises a capability and then refuses it; an account with a single basket has no second list and
 * should simply not be offered one.
 *
 * **No money is computed.** The price is the server's `lineTotal` rendered through {@link Amount}, and
 * the fact line beside the kind counts the line's own quantity through the shared {@link groupNoun} —
 * a count of things, never an arithmetic over figures.
 *
 * §B.4: the card is one tonal step with a radius. The full borders belong to the controls on it.
 */

// #region Props
/** Props for {@link BasketListCard}. */
export interface BasketListCardProps {
	/** The line to draw. */
	item: BasketItem;
	/** Whether a write is in flight for this line. */
	busy: boolean;
	/** The baskets this line can be moved INTO — the open one is filtered out by the caller. */
	destinations: readonly BasketSummary[];
	/** Move the line into the open basket (unpark it, or pull it out of the list being browsed). */
	onMoveToBasket: (item: BasketItem) => void;
	/** Move the line into another named list. */
	onMoveToList: (item: BasketItem, toBasketId: string) => void;
	/** Remove the line outright. */
	onRemove: (item: BasketItem) => void;
}
// #endregion

export function BasketListCard(props: BasketListCardProps): JSX.Element {
	const { item, busy } = props;
	const menuOpen = useSignal(false);
	const meta = itemKindMeta(item.itemType);

	return (
		<li class="bsk-card" data-busy={busy ? "true" : undefined}>
			{
				/*
				 * Out of the accessibility tree and out of the tab order: the title below is this card's one
				 * link to the same place, and a second route would announce the item twice.
				 */
			}
			<a class="bsk-card__media" href={itemHref(item)} aria-hidden="true" tabIndex={-1}>
				{item.thumbnail
					? <img src={item.thumbnail} alt="" loading="lazy" decoding="async" />
					: (
						<span class="bsk-card__glyph">
							<Icon name={groupIconName(meta.group)} size="lg" />
						</span>
					)}
			</a>

			<div class="bsk-card__body">
				<p class="bsk-card__kind">{meta.label}</p>

				<h3 class="bsk-card__heading">
					<a class="bsk-card__title" href={itemHref(item)}>{item.title}</a>
				</h3>

				<p class="bsk-card__fact">
					{groupNoun(meta.group, item.quantity)}
					{item.sellerName && <span class="bsk-card__seller">{item.sellerName}</span>}
				</p>

				{!item.available && item.unavailableReason && (
					<p class="bsk-card__flag" role="status">{item.unavailableReason}</p>
				)}
			</div>

			{
				/*
				 * The card's foot: the one committing move at the inline START, the price flush to the
				 * inline END. Both on the last line of a FIXED-height card, so the figure lands on the same
				 * baseline in every card across the shelf — the whole reason the card height is fixed rather
				 * than content-driven.
				 */
			}
			<div class="bsk-card__buy">
				<Button
					variant="outlined"
					severity="primary"
					size="sm"
					rounded
					icon={<Icon name="basket" />}
					disabled={busy || !item.available}
					aria-label={`Move to Basket — ${item.title}`}
					onClick={() => props.onMoveToBasket(item)}
				>
					<span class="bsk-card__action-label">Move to Basket</span>
				</Button>

				<p class="bsk-card__price">
					<Amount value={item.lineTotal} hideOrigin />
				</p>
			</div>

			{
				/*
				 * The two quiet moves, and the list menu, on the card's last row.
				 *
				 * Custom zero-padding links rather than package Buttons (see {@link LineAction}): a card this
				 * short cannot spend a control's inline padding twice and still fit a cover, a title and a
				 * price at a fixed height.
				 */
			}
			<div class="bsk-card__quiet">
				<RemoveAction
					compact
					subject={item.title}
					disabled={busy}
					onClick={() => props.onRemove(item)}
				/>

				{
					/*
					 * A NATIVE button, not the `Button` component: the popover anchors to its trigger through
					 * a ref, and Preact does not forward `ref` through a function component without
					 * `preact/compat`, which this stack deliberately avoids. It wears the same `.bsk-act`
					 * class as its siblings so the three read as one control family.
					 */
				}
				{props.destinations.length > 0 && (
					<Popover
						open={menuOpen}
						placement="bottom-end"
						label={`Lists for ${item.title}`}
						class="bsk-menu"
						trigger={(api) => (
							<button
								type="button"
								class="bsk-act ui-hit"
								data-compact="true"
								disabled={busy}
								aria-label={`Add to List — ${item.title}`}
								aria-haspopup="dialog"
								aria-expanded={api.expanded ? "true" : "false"}
								aria-controls={api.panelId}
								onClick={api.toggle}
								ref={api.ref as RefObject<HTMLButtonElement>}
							>
								<Icon name="bookmark" size="2xs" />
								<span class="bsk-act__label">Add to List</span>
							</button>
						)}
					>
						{
							/*
							 * Each destination is its own row naming its own list, rather than a "Move to list…"
							 * heading over anonymous names: the row's accessible name then states the whole
							 * action ("Move to 3D assets"), which is what a voice-control reader says out loud.
							 */
						}
						{props.destinations.map((target) => (
							<button
								key={target.id}
								type="button"
								class="bsk-menu__item"
								disabled={busy}
								onClick={() => {
									menuOpen.value = false;
									props.onMoveToList(item, target.id);
								}}
							>
								<Icon name={target.isDefault ? "basket" : "bookmark"} />
								<span>Move to {target.name}</span>
							</button>
						))}
					</Popover>
				)}
			</div>
		</li>
	);
}
