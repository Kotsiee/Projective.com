import { isCheckoutEligible, itemKindMeta } from "@projective/types/finance";
import type { IconName } from "@projective/ui/icons";
import { itemKindLabel, scheduleHref, stageHref } from "./basket-model.ts";
import type {
	Basket,
	BasketItem,
	MoneyView,
	PurchasableItemGroup,
} from "../types/checkout-types.ts";

/**
 * basket-view — the pure projection layer between the server's {@link Basket} and the `/basket` body.
 *
 * Everything here is total, synchronous and DOM-free, so the same function answers during SSR and
 * after hydration and the two can never draw different rows. Nothing in this file does money
 * arithmetic: the only figures it touches are the server's pre-formatted {@link MoneyView.display}
 * strings, and the only thing it does with them is put them in a sentence.
 *
 * The one function that deserves a second look is {@link groupsFor}. The brief and the SSOT both say
 * the client never groups a basket — {@link Basket.groups} is a server-computed index and this module
 * renders it in the order it arrives. What {@link groupsFor} adds is a **leftover bucket**: any line
 * the server placed in no group at all. That is not client-side grouping, it is a refusal to drop a
 * line. A basket that silently omits something the buyer added is the worst failure this surface can
 * have, and the bucket is deliberately rendered WITHOUT a subtotal, because there is no server figure
 * for it and a client-summed one would be exactly the second arithmetic path the money contract exists
 * to prevent.
 */

// #region Density
/** The two presentations the footer rig's density slider switches between. */
export type BasketDensity = "list" | "card";

/**
 * The presentation a density value resolves to.
 *
 * The threshold mirrors the footer rig's own `formatValue` (`v < 0.5 → "List view"`), so the label the
 * reader is shown and the layout they get are decided by one number in one place.
 */
export function densityOf(zoom: number): BasketDensity {
	return zoom < 0.5 ? "list" : "card";
}
// #endregion

// #region Narrowing
/**
 * Whether a line survives the header band's find-in-basket query.
 *
 * Matches across every fact the row actually shows — title, subtitle, seller, kind, stage and the
 * digital-product facets — because a reader who can see a word on a row expects searching for it to
 * keep that row.
 */
export function matchesQuery(item: BasketItem, query: string): boolean {
	if (query === "") return true;
	const haystack = [
		item.title,
		item.subtitle,
		item.sellerName,
		item.sellerHandle,
		item.stageLabel,
		item.licence,
		item.format,
		item.scheduledLabel,
		itemKindLabel(item),
	];
	return haystack.some((value) => value !== null && value.toLowerCase().includes(query));
}
// #endregion

// #region Groups
/**
 * One rendered section of the basket body — a server {@link BasketGroup} narrowed to the lines that
 * survived the current search, or the leftover bucket described in this module's header.
 */
export interface RenderGroup {
	/** Stable key for the section. */
	key: string;
	/** The purchasable family, which decides the heading glyph. */
	group: PurchasableItemGroup;
	label: string;
	caption: string | null;
	/** Deep link to the project/service this group is anchored to. */
	href: string | null;
	/**
	 * The server's subtotal for the group's SELECTED lines, or `null` for the leftover bucket — where
	 * no server figure exists and none may be invented.
	 */
	subtotal: MoneyView | null;
	/** How many lines the server placed in this group, before any search narrowed it. */
	itemCount: number;
	/** The lines being drawn right now. */
	items: BasketItem[];
	/** True for the client-assembled bucket of lines the server placed in no group. */
	orphan: boolean;
}

/**
 * Project the server's groups onto the currently visible lines, then sweep up anything unclaimed.
 *
 * Empty sections are dropped rather than rendered as headings over nothing, so a search narrows the
 * body to the sections that actually matched.
 */
export function groupsFor(basket: Basket, visible: readonly BasketItem[]): RenderGroup[] {
	const byId = new Map(visible.map((item) => [item.id, item]));
	const claimed = new Set<string>();
	const sections: RenderGroup[] = [];

	for (const group of basket.groups) {
		const items: BasketItem[] = [];
		for (const id of group.itemIds) {
			const item = byId.get(id);
			if (!item) continue;
			claimed.add(id);
			items.push(item);
		}
		if (items.length === 0) continue;
		sections.push({
			key: group.id,
			group: group.group,
			label: group.label,
			caption: group.caption,
			href: group.href,
			subtotal: group.subtotal,
			itemCount: group.itemCount,
			items,
			orphan: false,
		});
	}

	const orphans = visible.filter((item) => !claimed.has(item.id));
	if (orphans.length > 0) {
		sections.push({
			key: "bsk-ungrouped",
			group: itemKindMeta(orphans[0].itemType).group,
			label: "Everything else",
			caption: "Lines this basket has not filed under a project or a seller yet.",
			href: null,
			subtotal: null,
			itemCount: orphans.length,
			items: orphans,
			orphan: true,
		});
	}

	return sections;
}
// #endregion

// #region Line facts
/** One kind-specific fact a row shows beneath its title. */
export interface LineFact {
	key: string;
	/** The fact's name, always rendered as visible text — never only as a glyph. */
	label: string;
	/** The resolved value, or the wording for a fact that is still missing. */
	value: string;
	/** Where the reader goes to supply or change the fact; `null` when no route exists. */
	href: string | null;
	icon: IconName;
	/** Whether the fact is still OUTSTANDING and will block a checkout until it is resolved. */
	pending: boolean;
}

/**
 * The facts a line's kind makes it responsible for.
 *
 * Driven entirely by the SSOT's {@link itemKindMeta}, so a new purchasable kind changes one table in
 * `packages/types/finance` rather than a `switch` in this feature. A row is adaptive because its KIND
 * is, not because the layout guesses from which fields happen to be non-null.
 */
export function factsFor(item: BasketItem): LineFact[] {
	const meta = itemKindMeta(item.itemType);
	const facts: LineFact[] = [];

	if (item.licence) {
		facts.push({
			key: "licence",
			label: "Licence",
			value: item.licence,
			href: null,
			icon: "shield",
			pending: false,
		});
	}
	if (item.format) {
		facts.push({
			key: "format",
			label: "Format",
			value: item.format,
			href: null,
			icon: "download",
			pending: false,
		});
	}
	if (meta.needsSchedule) {
		const booked = item.scheduledLabel !== null;
		facts.push({
			key: "slot",
			label: booked ? "Booked" : "Slot",
			value: booked
				? (item.timezone ? `${item.scheduledLabel} · ${item.timezone}` : item.scheduledLabel!)
				: "No time chosen yet",
			href: scheduleHref(item),
			icon: "calendar",
			pending: !booked,
		});
	}
	if (meta.needsStage) {
		const routed = item.stageLabel !== null;
		facts.push({
			key: "stage",
			label: "Stage",
			value: routed ? item.stageLabel! : "No stage chosen yet",
			href: stageHref(item),
			icon: "stages",
			pending: !routed,
		});
	}

	return facts;
}

/**
 * The noun the line's quantity stepper counts.
 *
 * A group-session line carries both a quantity and a seat count, and the two are the same number
 * expressed twice; labelling the control "Seats" there — and writing both fields together — keeps them
 * from ever drifting apart into a line that claims to hold three seats and charges for two.
 */
export function quantityLabel(item: BasketItem): string {
	return item.seats !== null ? "Seats" : "Quantity";
}
// #endregion

// #region Money presentation
/**
 * Everything a row renders about what a line costs — every field a server-formatted string, assembled
 * here so the row markup carries no branching over which discount channels are present.
 */
export interface LinePriceView {
	/** The line total, `unitPrice × quantity − discountAmount`, computed server-side. */
	total: MoneyView;
	/** The charged per-unit price, shown only when it is not simply the total. */
	unit: MoneyView | null;
	/** The struck-through pre-discount UNIT price, when the creator is running one against an RRP. */
	rrp: MoneyView | null;
	/** The creator discount across the whole quantity, when one applies. */
	saving: MoneyView | null;
	/** The code that produced {@link saving}. */
	code: string | null;
	/**
	 * The one sentence that carries every price on the row to assistive technology.
	 *
	 * The visual treatment leans on a strike-through and a coloured badge, and neither survives a
	 * screen reader or a colour-vision deficiency on its own. This sentence is the row's accessible
	 * account of its own price, and it names BOTH figures whenever there are two.
	 */
	statement: string;
}

/** Project a line's money fields into everything the row needs to draw and to announce. */
export function linePriceView(item: BasketItem): LinePriceView {
	const rrp = item.originalPrice;
	const saving = item.discountAmount.minor > 0 ? item.discountAmount : null;
	const multiple = item.quantity > 1;
	const unit = multiple || rrp !== null || saving !== null ? item.unitPrice : null;

	const parts: string[] = [];
	if (rrp) {
		parts.push(
			`Recommended price ${rrp.display} each, reduced to ${item.unitPrice.display} each.`,
		);
	} else if (unit) {
		parts.push(`${unit.display} each.`);
	}
	if (multiple) parts.push(`${item.quantity} × ${quantityLabel(item).toLowerCase()}.`);
	if (saving) {
		parts.push(
			item.discountCode
				? `Creator discount ${item.discountCode} saves ${saving.display} on this line.`
				: `Creator discount saves ${saving.display} on this line.`,
		);
	}
	parts.push(`Line total ${item.lineTotal.display}.`);

	return {
		total: item.lineTotal,
		unit,
		rrp,
		saving,
		code: item.discountCode,
		statement: parts.join(" "),
	};
}
// #endregion

// #region Line state
/**
 * Whether a line is currently counted toward the basket's totals.
 *
 * Delegates to the SSOT's {@link isCheckoutEligible} rather than restating "selected and available and
 * not parked", so the row's dimmed state, the group's caption and the server's subtotal are all
 * answering the same question with the same function.
 */
export function isCounted(item: BasketItem, selected: boolean): boolean {
	return isCheckoutEligible({ ...item, isSelectedForCheckout: selected });
}
// #endregion

// #region Empty states
/** The wording an empty region is announced with. */
export interface EmptyCopy {
	title: string;
	note: string;
}

/**
 * The empty state, named for the scope it is actually empty FOR.
 *
 * "Your basket is empty" on a team's basket is a small lie with a real consequence: the reader is
 * looking at the wrong account's money and the copy has just told them they are looking at their own.
 */
export function emptyScope(basket: Basket): EmptyCopy {
	if (!basket.isDefault) {
		return {
			title: `${basket.name} is empty`,
			note:
				"This is one of your saved lists. Anything you park here stays until you move it into a basket.",
		};
	}
	switch (basket.ownerType) {
		case "team":
			return {
				title: `${basket.name}’s team basket is empty`,
				note: "Anything added here is paid for by the team’s wallet, not by you personally.",
			};
		case "business":
			return {
				title: `${basket.name}’s business basket is empty`,
				note: "Anything added here is paid for by the business wallet, not by you personally.",
			};
		case "organisation":
			return {
				title: `${basket.name}’s organisation basket is empty`,
				note:
					"Anything added here is paid for by the organisation’s wallet, not by you personally.",
			};
		default:
			return {
				title: "Your basket is empty",
				note: "Anything you add from a listing lands here, ready to check out when you are.",
			};
	}
}

/**
 * The empty state for a search that narrowed the active list to nothing.
 *
 * It takes the number of PARKED matches because "nothing matches" would be false when the shelf below
 * is showing two of them — the reader would be told there is nothing while looking straight at
 * something.
 */
export function emptySearch(query: string, parkedMatches: number): EmptyCopy {
	if (parkedMatches > 0) {
		return {
			title: `Nothing in the basket matches “${query}”`,
			note: parkedMatches === 1
				? "One saved-for-later line matches. It is on the shelf below."
				: `${parkedMatches} saved-for-later lines match. They are on the shelf below.`,
		};
	}
	return {
		title: `Nothing in this basket matches “${query}”`,
		note: "Clear the search in the header to see everything again.",
	};
}
// #endregion
