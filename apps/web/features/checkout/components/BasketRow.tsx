import type { JSX } from "preact";
import { itemKindMeta } from "@projective/types/finance";
import { Button, Checkbox, InputNumber } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { Amount } from "./Amount.tsx";
import { itemHref, itemKindLabel, sellerHref } from "../core/basket-model.ts";
import { factsFor, isCounted, linePriceView, quantityLabel } from "../core/basket-view.ts";
import type { LineSignals } from "../core/basket-lines.ts";
import { groupIconName } from "./checkout-glyphs.tsx";
import { EmailAssignment } from "./EmailAssignment.tsx";
import type { BasketItem } from "../types/checkout-types.ts";

/**
 * BasketRow — one line of a basket, in either density.
 *
 * **One DOM, two presentations.** The list row and the card are the same markup with different CSS
 * (`.bsk[data-density]` + `@container`), not two components. A second component would be a second
 * place for a fact to be forgotten, and the density control lives in the footer band where it can
 * change at any moment — a reader who switches to cards must not lose the address field they were
 * halfway through typing, which a component swap would unmount.
 *
 * **The row is adaptive by KIND, not by which fields happen to be populated.** The SSOT's
 * `itemKindMeta` decides whether an address, a slot or a stage is this line's responsibility, so a
 * session with no booking still shows an unbooked slot rather than silently omitting the fact that is
 * about to block the checkout.
 *
 * **Nothing here computes money.** Every figure is a server `MoneyView.display`; the price block only
 * decides which of them to show and assembles one sentence naming all of them for assistive
 * technology, because a strike-through and a coloured badge are not channels a screen reader or a
 * colour-blind reader can read (§A.5).
 */

// #region Props
/** Props for {@link BasketRow}. */
export interface BasketRowProps {
	/** The line to draw. */
	item: BasketItem;
	/** The line's controlled field bindings. */
	signals: LineSignals;
	/** Whether a write is in flight for this line. */
	busy: boolean;
	/** Whether the line reads as selected right now (optimistic overlay included). */
	selected: boolean;
	/** Parked rows carry no selection and no quantity — only a way back into the basket. */
	parked?: boolean;
	/** Toggle selection for checkout. */
	onToggle: (item: BasketItem, next: boolean) => void;
	/** Commit a new quantity (and seat count, on a line that holds seats). */
	onQuantity: (item: BasketItem, next: number) => void;
	/** Park a line into saved-for-later, or move it back. */
	onPark: (item: BasketItem, parked: boolean) => void;
	/** Remove the line outright. */
	onRemove: (item: BasketItem) => void;
	/** Commit a delivery address for a digital deliverable. */
	onEmail: (item: BasketItem, address: string) => void;
}
// #endregion

export function BasketRow(props: BasketRowProps): JSX.Element {
	const { item, signals, busy, selected, parked = false } = props;

	const meta = itemKindMeta(item.itemType);
	const facts = factsFor(item);
	const price = linePriceView(item);
	const counted = !parked && isCounted(item, selected);
	const reasonId = `bsk-reason-${item.id}`;
	const qtyId = `bsk-qty-${item.id}`;
	const seller = sellerHref(item);

	return (
		<li
			class="bsk-row"
			data-available={item.available ? undefined : "false"}
			data-busy={busy ? "true" : undefined}
			data-counted={counted ? undefined : "false"}
			data-parked={parked ? "true" : undefined}
		>
			{!parked && (
				<div class="bsk-row__select">
					<Checkbox
						value={signals.selected}
						disabled={!item.available || busy}
						aria-label={`Include ${item.title} in this checkout`}
						aria-describedby={item.available ? undefined : reasonId}
						onValueChange={(next) => props.onToggle(item, next)}
					/>
				</div>
			)}

			{
				/*
				 * A second route to the same destination, kept out of the accessibility tree and out of the
				 * tab order: the title below is the row's one link. Removing it entirely would leave the card
				 * presentation with an image that looks clickable and is not.
				 */
			}
			<a class="bsk-row__media" href={itemHref(item)} aria-hidden="true" tabIndex={-1}>
				{item.thumbnail
					? <img src={item.thumbnail} alt="" loading="lazy" decoding="async" />
					: (
						<span class="bsk-row__glyph">
							<Icon name={groupIconName(meta.group)} size="md" />
						</span>
					)}
			</a>

			<div class="bsk-row__main">
				<h3 class="bsk-row__heading">
					<a class="bsk-row__title" href={itemHref(item)}>{item.title}</a>
				</h3>

				<p class="bsk-row__meta">
					<span class="bsk-row__kind">{itemKindLabel(item)}</span>
					{item.subtitle && <span class="bsk-row__subtitle">{item.subtitle}</span>}
					{item.sellerName && (
						seller
							? <a class="bsk-row__seller" href={seller}>{item.sellerName}</a>
							: <span class="bsk-row__seller">{item.sellerName}</span>
					)}
				</p>

				{facts.length > 0 && (
					<ul class="bsk-row__facts">
						{facts.map((fact) => (
							<li
								key={fact.key}
								class="bsk-row__fact"
								data-pending={fact.pending ? "true" : undefined}
							>
								<Icon name={fact.icon} size="xs" />
								<span class="bsk-row__fact-label">{fact.label}</span>
								{fact.href
									? <a class="bsk-row__fact-value" href={fact.href}>{fact.value}</a>
									: <span class="bsk-row__fact-value">{fact.value}</span>}
							</li>
						))}
					</ul>
				)}

				{meta.needsEmail && !parked && (
					<EmailAssignment
						item={item}
						signals={signals}
						busy={busy}
						onCommit={props.onEmail}
					/>
				)}

				{!item.available && (
					<p class="bsk-row__flag" id={reasonId}>
						<Icon name="warning" size="xs" />
						<span>{item.unavailableReason ?? "This line can no longer be bought."}</span>
					</p>
				)}
			</div>

			{!parked && (
				<div class="bsk-row__qty">
					<label class="bsk-row__qty-label" for={qtyId}>{quantityLabel(item)}</label>
					{
						/*
						 * Deliberately WITHOUT `showButtons`. The package's spinner buttons render 28×13 at
						 * their natural width and shrink from there, which is under the 24px hit-target floor
						 * (WCAG 2.5.8) and they carry no `.ui-hit` overlay — measured, not assumed. The bare
						 * field is 32px tall, meets the floor, and keeps the native up/down keys. The package
						 * defect is reported rather than patched around here.
						 */
					}
					<InputNumber
						id={qtyId}
						size="sm"
						fluid
						min={1}
						max={item.seats !== null ? 500 : 999}
						step={1}
						value={signals.quantity}
						disabled={!item.available || busy}
						aria-label={`${quantityLabel(item)} — ${item.title}`}
						onValueChange={(next) => {
							if (next === null) return;
							props.onQuantity(item, next);
						}}
					/>
				</div>
			)}

			<LinePrice item={item} price={price} />

			<div class="bsk-row__actions">
				{
					/*
					 * The accessible name CONTAINS the visible words ("Save for later — …"), not a rewording
					 * of them. A label of "Save Motion primitives for later" beside visible text reading
					 * "Save for later" fails "label in name" (WCAG 2.5.3) and breaks voice control, which is
					 * the exact bug `CatalogueCreateModal` shipped.
					 */
				}
				<Button
					variant="text"
					severity="secondary"
					size="sm"
					icon={<Icon name={parked ? "basket" : "bookmark"} />}
					disabled={busy}
					aria-label={parked ? `Move back — ${item.title}` : `Save for later — ${item.title}`}
					onClick={() => props.onPark(item, !parked)}
				>
					<span class="bsk-row__action-label">{parked ? "Move back" : "Save for later"}</span>
				</Button>
				<Button
					variant="text"
					severity="danger"
					size="sm"
					iconOnly
					icon={<Icon name="trash" />}
					disabled={busy}
					aria-label={`Remove ${item.title} from this basket`}
					onClick={() => props.onRemove(item)}
				/>
			</div>
		</li>
	);
}

// #region Price
/** Props for {@link LinePrice}. */
interface LinePriceProps {
	item: BasketItem;
	price: ReturnType<typeof linePriceView>;
}

/**
 * What a line costs.
 *
 * Every figure renders through the shared {@link Amount}, which is the one way a `MoneyView` reaches
 * the screen on this surface — a second money renderer in the basket would eventually disagree with
 * the checkout about where a locale puts its pence.
 *
 * The visible treatment is deliberately redundant — a struck recommended price, the charged price, and
 * a worded saving badge — and then the whole block is repeated once, invisibly, as a single sentence
 * naming every figure. Strike-through and colour are the two channels a discount is usually drawn in
 * and neither survives assistive technology or a colour-vision deficiency, so the sentence is the
 * price's real accessible account of itself and the marks above it are decoration.
 */
function LinePrice({ item, price }: LinePriceProps): JSX.Element {
	return (
		<p class="bsk-price">
			<span class="ui-visually-hidden">{price.statement}</span>

			<span class="bsk-price__total" aria-hidden="true">
				<Amount value={price.total} size="lead" />
			</span>

			{price.unit && (
				<span class="bsk-price__unit" aria-hidden="true">
					{price.rrp && (
						<>
							<span class="bsk-price__rrp-label">RRP</span>
							<s class="bsk-price__was">
								<Amount value={price.rrp} size="micro" tone="struck" />
							</s>
						</>
					)}
					<span class="bsk-price__each">
						<Amount value={price.unit} size="micro" tone="muted" />
						{" each"}
					</span>
				</span>
			)}

			{price.saving && (
				<span class="bsk-price__save" aria-hidden="true">
					<Icon name="tag" size="xs" />
					<span>
						Save <Amount value={price.saving} size="micro" tone="credit" />
						{price.code ? ` · ${price.code}` : ""}
					</span>
				</span>
			)}

			{item.quantity > 1 && (
				<span class="bsk-price__qty" aria-hidden="true">
					{item.quantity} × {quantityLabel(item).toLowerCase()}
				</span>
			)}
		</p>
	);
}
// #endregion
