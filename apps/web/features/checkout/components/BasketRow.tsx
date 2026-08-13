import type { JSX } from "preact";
import { itemKindMeta } from "@projective/types/finance";
import { Checkbox } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { Amount } from "./Amount.tsx";
import { ParkAction, RemoveAction } from "./LineAction.tsx";
import { itemHref, itemKindLabel, sellerHref } from "../core/basket-model.ts";
import { factsFor, isCounted, linePriceView } from "../core/basket-view.ts";
import { conferencingLabel } from "../core/lists-model.ts";
import type { LineSignals } from "../core/basket-lines.ts";
import { groupIconName } from "./checkout-glyphs.tsx";
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
 * **The row reads top-left to bottom-right, in the order a buyer asks the questions.** Who made it
 * (the seller, a step above the title, in the quietest type on the row) · what it is (the title) ·
 * what shape it is (the facts, each a muted LABEL against a brighter VALUE, so the eye lands on the
 * answer rather than on the question) · which kind it is (the outlined chip, top-right, the one place
 * the SSOT's kind vocabulary appears) · what it costs (bottom-right, the row's largest figure) · and
 * only then what can be done with it (two quiet text actions, beneath).
 *
 * **The row is adaptive by KIND, not by which fields happen to be populated.** The SSOT's
 * `itemKindMeta` decides whether a slot or a stage is this line's responsibility, so a session with no
 * booking still shows an unbooked slot rather than silently omitting the fact that is about to block
 * the checkout.
 *
 * **The delivery address is NOT collected here.** A digital line used to carry its own "Send this
 * download to" field; that question now belongs to the Details step, which is the one place the buyer
 * is asked who they are and where things go, and which validates it against the same SSOT rule. Asking
 * on the row as well gave the basket a second answer to a question the flow already owns — and a row
 * that asked it per line meant a buyer with four downloads answered it four times. `CheckoutLine`
 * still mounts `EmailAssignment` on the later steps, where a per-line override is a genuine choice
 * rather than a duplicate of the buyer's own record.
 *
 * **A line the basket is not going to charge for says so in three channels at once** — struck, dimmed,
 * and named in the invisible price statement — because a strike-through is a shape channel and dimming
 * is a contrast one, and neither reaches a screen reader.
 *
 * **Nothing here computes money.** Every figure is a server `MoneyView` rendered through the shared
 * {@link Amount}; the price block only decides which of them to show and assembles one sentence naming
 * all of them for assistive technology (§A.5).
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
	/**
	 * Whether the flagged-lines notice has just sent the reader here.
	 *
	 * A transient MARK, not a state of the line: it says "this is the row you asked for", which is why
	 * it expires. The reason the line cannot be bought is stated in words on the row itself and does not
	 * depend on this at all.
	 */
	flagged?: boolean;
	/**
	 * Whether the row sits inside an engagement block that already names the seller and shows the
	 * cover. The row then drops both rather than repeating the block's own header on every line.
	 */
	nested?: boolean;
	/** Toggle selection for checkout. */
	onToggle: (item: BasketItem, next: boolean) => void;
	/** Park a line into saved-for-later, or move it back. */
	onPark: (item: BasketItem, parked: boolean) => void;
	/** Remove the line outright. */
	onRemove: (item: BasketItem) => void;
}
// #endregion

/** The DOM id a line is addressable by, so the summary's delivery list can jump straight to it. */
export function rowDomId(item: BasketItem): string {
	return `bsk-line-${item.id}`;
}

export function BasketRow(props: BasketRowProps): JSX.Element {
	const { item, signals, busy, selected, parked = false, nested = false, flagged = false } = props;

	const meta = itemKindMeta(item.itemType);
	const facts = factsFor(item);
	const price = linePriceView(item);
	const counted = !parked && isCounted(item, selected);
	const reasonId = `bsk-reason-${item.id}`;
	const seller = sellerHref(item);
	const conferencing = conferencingLabel(item);

	return (
		<li
			class="bsk-row"
			id={rowDomId(item)}
			data-available={item.available ? undefined : "false"}
			data-busy={busy ? "true" : undefined}
			data-counted={counted ? undefined : "false"}
			data-parked={parked ? "true" : undefined}
			data-nested={nested ? "true" : undefined}
			data-flagged={flagged ? "true" : undefined}
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
				{item.sellerName && (
					<p class="bsk-row__seller">
						{seller
							? <a class="bsk-row__seller-link" href={seller}>{item.sellerName}</a>
							: item.sellerName}
					</p>
				)}

				<h3 class="bsk-row__heading">
					<a class="bsk-row__title" href={itemHref(item)}>{item.title}</a>
				</h3>

				{item.subtitle && <p class="bsk-row__subtitle">{item.subtitle}</p>}

				{(facts.length > 0 || conferencing) && (
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

						{
							/*
							 * Only when the line genuinely records one. A fabricated provider beside a booked
							 * slot is a commitment the platform has not made (see `conferencingLabel`).
							 */
						}
						{conferencing && (
							<li class="bsk-row__fact">
								<Icon name="video" size="xs" />
								<span class="bsk-row__fact-label">Meeting</span>
								<span class="bsk-row__fact-value">{conferencing}</span>
							</li>
						)}
					</ul>
				)}

				{!item.available && (
					<p class="bsk-row__flag" id={reasonId}>
						<Icon name="warning" size="xs" />
						<span>{item.unavailableReason ?? "This line can no longer be bought."}</span>
					</p>
				)}
			</div>

			{
				/*
				 * The kind chip. Outlined because it is the row's one categorical mark and §B.4 reserves a
				 * full outline for something that is either interactive or genuinely a token; a revision is
				 * a second, rarer mark and earns the warning ramp because it is money spent again on work
				 * already delivered.
				 */
			}
			{
				/*
				 * The row's top-right stack: the categorical mark, then the saving directly beneath it.
				 *
				 * The saving used to sit inside the price block, which put a pill between the charged figure
				 * and the row beneath it and knocked the price off the baseline its neighbours share. Here
				 * the two read as one column of facts ABOUT the line, and the bottom-right corner is left to
				 * the single thing a buyer scans a basket for.
				 */
			}
			<div class="bsk-row__marks">
				<p class="bsk-row__tags">
					{item.revisionId && <span class="bsk-row__tag" data-tone="revision">Revision</span>}
					<span class="bsk-row__tag">{itemKindLabel(item)}</span>
				</p>

				{price.saving && (
					<p class="bsk-price__save" aria-hidden="true">
						<Icon name="tag" size="2xs" />
						<span class="bsk-price__save-text">
							Save <Amount value={price.saving} size="micro" tone="credit" />
							{price.code ? ` · ${price.code}` : ""}
						</span>
					</p>
				)}
			</div>

			<LinePrice price={price} />

			<div class="bsk-row__foot">
				<div class="bsk-row__actions">
					<RemoveAction
						subject={item.title}
						disabled={busy}
						onClick={() => props.onRemove(item)}
					/>
					<ParkAction
						parked={parked}
						subject={item.title}
						disabled={busy}
						onClick={() => props.onPark(item, !parked)}
					/>
				</div>
			</div>
		</li>
	);
}

// #region Price
/** Props for {@link LinePrice}. */
interface LinePriceProps {
	price: ReturnType<typeof linePriceView>;
}

/**
 * What a line costs.
 *
 * Every figure renders through the shared {@link Amount}, which is the one way a `MoneyView` reaches
 * the screen on this surface — a second money renderer in the basket would eventually disagree with
 * the checkout about where a locale puts its pence. The typographic nicety of raising the minor units
 * is deliberately NOT attempted: it would mean parsing a server-formatted string, and a parsed figure
 * cannot survive the currency bridge replacing that string wholesale (Decision #69).
 *
 * The visible treatment is deliberately redundant — a struck recommended price, the charged price, and
 * a worded saving badge — and then the whole block is repeated once, invisibly, as a single sentence
 * naming every figure. Strike-through and colour are the two channels a discount is usually drawn in
 * and neither survives assistive technology or a colour-vision deficiency, so the sentence is the
 * price's real accessible account of itself and the marks above it are decoration.
 */
function LinePrice({ price }: LinePriceProps): JSX.Element {
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

			{
				/*
				 * The saving is NOT drawn here — it lives in the row's top-right mark stack. The invisible
				 * `statement` above still names it, along with every other figure on the row, so the
				 * accessible account of the price is unchanged by the move.
				 *
				 * The quantity multiplier is gone with the quantity control: with nothing on the row able to
				 * change it, "2 × item" restated what the unit price and the line total already say between
				 * them.
				 */
			}
		</p>
	);
}
// #endregion
