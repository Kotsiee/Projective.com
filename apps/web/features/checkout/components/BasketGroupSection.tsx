import type { ComponentChildren, JSX } from "preact";
import type { Signal } from "@preact/signals";
import { Checkbox } from "@projective/ui/fields";
import { Amount } from "./Amount.tsx";
import { groupAnchorId } from "../core/lists-model.ts";
import type { RenderGroup } from "../core/basket-view.ts";
import type { MoneyView, PurchasableItemGroup } from "../types/checkout-types.ts";

/**
 * BasketGroupSection — the basket body's two nesting levels: the CATEGORY a buyer scans by, and the
 * ENGAGEMENT block a set of tickets or sessions belongs to.
 *
 * ## Two levels, one server index
 *
 * The server's `basket.groups` is an index over the lines, one entry per *engagement* ("Brand identity
 * sprint", "Portfolio review"), plus a single entry holding every digital product. A buyer does not
 * scan by engagement first — they scan by **Products · Tickets · Sessions**. {@link categoriesOf} is
 * therefore a re-index of the server's own groups into those three headings, exactly as the lane's
 * `basketListsFrom` already re-indexes them into its Tickets and Sessions sections. It is a
 * re-ordering of server groups, never a re-grouping of lines, and it moves no money.
 *
 * ## Where a subtotal may be printed, and where it may not
 *
 * A `BasketGroup` carries a server-computed `subtotal`. A CATEGORY does not — there is no
 * per-category figure in the projection — so a category that rolls up several engagement groups has
 * **no figure this surface is allowed to state**, because stating one would mean adding two server
 * totals together and that is the second arithmetic path the money contract exists to prevent.
 *
 * The closing "Subtotal" line therefore prints once, at the outermost level that has exactly ONE
 * server figure behind it: on the category when the category holds a single group (which is always
 * true of Products), and on each engagement block otherwise. Every section still ends in a right-
 * aligned subtotal; the only thing that moves is which unit it closes. A per-category rollup in the
 * projection would collapse the two cases into one — see the work report.
 *
 * ## Separation (§B.4)
 *
 * A category is spacing and type weight — no box, no border, no tint. Its one device is the single
 * hairline above the closing subtotal. An engagement block is one tonal step with a radius, which is
 * the sanctioned way to nest without drawing a border around non-interactive content. The only full
 * outlines on either belong to the controls: the selection checkboxes and the links.
 */

// #region Category projection
/** The three headings a buyer scans a basket by. */
export type BasketCategoryKey = "products" | "tickets" | "sessions";

/** Enough of a server group to be tallied — satisfied by both `BasketGroup` and {@link RenderGroup}. */
export interface CountableGroup {
	group: PurchasableItemGroup;
	itemCount: number;
}

/**
 * The fixed reading order, and which SSOT families roll up under each heading.
 *
 * `project` and `service` share the Tickets heading because both are ticketed engagement work and a
 * buyer reasons about them as one thing — the same pairing the lane's `basketListsFrom` already makes.
 */
const CATEGORIES: readonly {
	key: BasketCategoryKey;
	label: string;
	families: readonly PurchasableItemGroup[];
}[] = [
	{ key: "products", label: "Products", families: ["product"] },
	{ key: "tickets", label: "Tickets", families: ["project", "service"] },
	{ key: "sessions", label: "Sessions", families: ["session"] },
];

/** One rendered heading of the basket body, holding the server groups that roll up under it. */
export interface BasketCategory {
	key: BasketCategoryKey;
	label: string;
	/** The server groups filed here, in the order the server sent them. */
	groups: RenderGroup[];
	/**
	 * The server figure closing the whole category, or `null` when several groups price it and no
	 * single server total exists. Never summed — see this module's header.
	 */
	subtotal: MoneyView | null;
	/** Whether the category's lines render flat, rather than inside engagement blocks. */
	flat: boolean;
}

/**
 * Re-index the visible server groups into the three reading categories.
 *
 * Empty categories are dropped rather than drawn as a heading over nothing, and any group whose
 * family is not one of the nine known ones would simply not appear — which cannot happen, since the
 * families are the SSOT's own closed enum.
 */
export function categoriesOf(sections: readonly RenderGroup[]): BasketCategory[] {
	const built: BasketCategory[] = [];
	for (const entry of CATEGORIES) {
		const groups = sections.filter((section) => entry.families.includes(section.group));
		if (groups.length === 0) continue;
		// A group the server anchored to no engagement (the products bucket, the leftover bucket) has
		// no identity of its own to draw, so its lines belong directly under the heading.
		const flat = groups.every((group) => group.href === null);
		built.push({
			key: entry.key,
			label: entry.label,
			groups,
			subtotal: groups.length === 1 ? groups[0].subtotal : null,
			flat,
		});
	}
	return built;
}

/**
 * The per-category line tally the summary card prints ("2 Products · 4 Tickets · 4 Sessions").
 *
 * Counting lines is not money arithmetic — these are the server's own per-group `itemCount`s added
 * up, and the headline total beside them is the basket's own `itemCount` rather than anything derived
 * here. It is deliberately fed the WHOLE basket's groups rather than the search-narrowed ones: the
 * summary describes the basket, not the current filter.
 */
export function categoryTallies(
	groups: readonly CountableGroup[],
): { key: BasketCategoryKey; label: string; count: number }[] {
	return CATEGORIES
		.map((entry) => ({
			key: entry.key,
			label: entry.label,
			count: groups
				.filter((group) => entry.families.includes(group.group))
				.reduce((total, group) => total + group.itemCount, 0),
		}))
		.filter((part) => part.count > 0);
}

/** The noun a group's lines are counted in, taken from the SSOT family rather than a second table. */
export function groupNoun(group: PurchasableItemGroup, count: number): string {
	const noun = group === "product" ? "Item" : group === "session" ? "Session" : "Ticket";
	return `${count} ${count === 1 ? noun : `${noun}s`}`;
}
// #endregion

// #region Category
/** Props for {@link BasketCategorySection}. */
export interface BasketCategorySectionProps {
	/** The re-indexed heading and the server groups under it. */
	category: BasketCategory;
	/**
	 * Bound select-every-line-here state.
	 *
	 * A `Signal`, never a raw boolean: `useControllable` seeds an internal signal from a raw value once
	 * and never reads the prop again, so a bulk checkbox bound to a plain boolean would freeze at the
	 * state it first painted while the lines under it moved.
	 */
	selection: Signal<boolean>;
	/** Whether only some of the category's lines are selected. */
	indeterminate: boolean;
	/** Whether the bulk control is currently refused (a write in flight, or nothing selectable). */
	disabled?: boolean;
	/** Select or deselect every selectable line under the heading. */
	onToggleAll: (next: boolean) => void;
	/** How many of the category's lines the header band's search is hiding. */
	hidden?: number;
	/** The rows or blocks, already built by the body so this component stays presentation-only. */
	children: ComponentChildren;
}
// #endregion

/** One reading category of the basket — Products, Tickets or Sessions. */
export function BasketCategorySection(props: BasketCategorySectionProps): JSX.Element {
	const { category, hidden = 0 } = props;
	// A flat category IS its one group, so it inherits that group's anchor and the lane's in-page
	// links keep landing. Nested categories give their anchors to the blocks instead.
	const anchorId = category.flat && category.groups.length === 1
		? groupAnchorId(category.groups[0].key)
		: `bsk-cat-${category.key}`;
	const headId = `${anchorId}-head`;

	return (
		<section class="bsk-cat" id={anchorId} aria-labelledby={headId} data-category={category.key}>
			<header class="bsk-cat__head">
				<Checkbox
					value={props.selection}
					indeterminate={props.indeterminate}
					disabled={props.disabled}
					aria-label={`Select every line under ${category.label}`}
					onValueChange={props.onToggleAll}
				/>
				<h2 class="bsk-cat__title" id={headId}>{category.label}</h2>
			</header>

			<div class="bsk-cat__body">{props.children}</div>

			{hidden > 0 && (
				<p class="bsk-cat__filtered">
					The search is hiding {hidden} {hidden === 1 ? "line" : "lines"} here.
				</p>
			)}

			{category.subtotal && <SubtotalLine value={category.subtotal} />}
		</section>
	);
}

/*
 * `BasketGroupBlock` — the old titled sub-section that wrapped every engagement in its own tinted,
 * rounded card — is GONE, and its replacement is {@link BasketEngagement} in its own module.
 *
 * Two things were wrong with it and neither was cosmetic. It drew a card INSIDE a category, which is
 * the card-in-card the surface now forbids outright; and by giving each project and service its own
 * heading it told the reader they had four purchases when they had one engagement priced four times.
 * The replacement keeps the server group as the unit — the projection was always shaped this way —
 * and spends whitespace on the hierarchy instead of a box.
 */

// #region Subtotal
/**
 * The line that closes a priced unit.
 *
 * One server `MoneyView` rendered through the shared {@link Amount} and nothing else — the label is a
 * word, the figure is the server's, and the single hairline above it is the whole separation device
 * (§B.4/§B.9: one boundary, one device).
 */
function SubtotalLine({ value }: { value: MoneyView }): JSX.Element {
	return (
		<p class="bsk-subtotal">
			<span class="bsk-subtotal__label">Subtotal</span>
			<span class="bsk-subtotal__value">
				<Amount value={value} size="lead" />
			</span>
		</p>
	);
}
// #endregion
