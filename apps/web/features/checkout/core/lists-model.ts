import { itemKindMeta } from "@projective/types/finance";
import { basketHref, checkoutStepHref } from "./basket-model.ts";
import type {
	Basket,
	BasketBootstrap,
	BasketItem,
	BasketListEntry,
	BasketLists,
	BasketSummary,
	MoneyView,
	PurchasableItemGroup,
} from "../types/checkout-types.ts";

/**
 * lists-model — the pure projection layer behind step 1's list explorer and its category blocks.
 *
 * Everything here is total, synchronous and DOM-free, so the same function answers during SSR and
 * after hydration and the lane can never disagree with the body about what a list holds.
 *
 * **Nothing in this module does money arithmetic.** Every figure it hands on is a `MoneyView` the
 * server already computed — a basket summary's `subtotal`, a group's `subtotal`, the open basket's
 * `net` — passed through by reference. Where no server figure exists (the parked shelf, which is not
 * checkout-eligible and therefore has no subtotal) the entry carries the same em-dash placeholder the
 * degraded SSR bootstraps use, and the lane declines to render it rather than printing a zero the
 * server never stated.
 *
 * ## Why the projection lives here for now
 *
 * The SSOT shape is {@link BasketLists} and its authoritative producer is the fat
 * `BasketBackendService.lists`, which computes the three sections in ONE pass so they cannot disagree
 * about a line's membership. Until that method lands, {@link basketListsFrom} builds the same shape
 * from the basket read the route already performs — a re-index of the server's own `baskets` and
 * `basket.groups`, never a second grouping and never a second total. When the fat method arrives the
 * route swaps its one call and every consumer below is unchanged.
 */

// #region Placeholder money
/**
 * The figure an entry carries when the server computed none for it.
 *
 * `display: "—"` rather than a formatted zero, because "£0.00" is a claim about a total and this is an
 * absence of one. Mirrors the degraded bootstraps in `checkout-ssr.ts`.
 */
function noFigure(currency: string): MoneyView {
	return { minor: 0, currency, display: "—", origin: null };
}
// #endregion

// #region The lane's navigation model
/**
 * Project a basket read into the lane's {@link BasketLists} model.
 *
 * Three sections, all derived from data the server already grouped:
 *
 * - **lists** — one entry per named basket (`finance.baskets` rows, default first), then the parked
 *   shelf as a trailing, deliberately non-checkoutable entry.
 * - **tickets** — the open basket's `project` and `service` groups, which are the engagements a ticket
 *   line routes through.
 * - **sessions** — the open basket's `session` groups.
 *
 * The two derived sections carry the server group's own label, caption, count and subtotal, so a group
 * named in the lane is the same row the body draws beneath the same heading.
 */
export function basketListsFrom(bootstrap: BasketBootstrap): BasketLists {
	const { basket, baskets, owner } = bootstrap;
	const currency = basket.currency;
	const activeId = basket.id || null;

	const lists: BasketListEntry[] = baskets.map((summary) => listEntryOf(summary, owner));
	if (basket.savedForLaterCount > 0) {
		lists.push({
			id: "saved",
			kind: "saved",
			label: "Saved for later",
			caption: countCaption(basket.savedForLaterCount, "parked line"),
			itemCount: basket.savedForLaterCount,
			subtotal: noFigure(currency),
			// The shelf is a section of the basket the reader is already in, so this is the one entry an
			// in-page anchor is still the right answer for — it is genuinely on screen, one scroll away.
			href: `${basketHref(activeId, owner)}#saved`,
			isDefault: false,
			// Parked lines are excluded from every total by definition, so offering a checkout from the
			// shelf would offer a purchase of nothing.
			checkoutable: false,
			thumbnail: null,
		});
	}

	return {
		lists,
		tickets: groupEntries(basket, owner, ["project", "service"], "ticket"),
		sessions: groupEntries(basket, owner, ["session"], "session"),
		activeId,
		// The last figure this step can state honestly: the platform fee and any tax are resolved
		// against a payment route the buyer has not chosen yet (see `BasketTotals`).
		activeSubtotal: basket.net,
		activeCheckoutHref: checkoutStepHref("details", activeId, owner),
	};
}

/** One named basket as a lane destination. */
function listEntryOf(summary: BasketSummary, owner: string): BasketListEntry {
	return {
		id: summary.id,
		kind: "basket",
		label: summary.name,
		caption: countCaption(summary.itemCount, "item"),
		itemCount: summary.itemCount,
		subtotal: summary.subtotal,
		href: basketHref(summary.id, owner),
		isDefault: summary.isDefault,
		checkoutable: true,
		thumbnail: null,
	};
}

/**
 * The open basket's groups of the given families, as lane destinations.
 *
 * ## The two things this has to agree with the server about
 *
 * This function and the fat `buildLists`/`derivedLists` produce the SAME model — the server's on the
 * first byte, this one after every mutation, because the body republishes the lane from the basket it
 * is actually showing. Two producers of one model is a drift risk, and it has already cost this
 * surface once:
 *
 * 1. **The id namespace.** `ticket:<parentId>` / `session:<parentId>`, which is what
 *    `isDerivedListId` and `derivedBasketOf` resolve. The server group's own `bg-…` id addresses one
 *    basket's slice; the derived id addresses the engagement across all of them.
 * 2. **The href is a ROUTE, not an anchor.** It used to be `…#bsk-group-…`, which could only ever
 *    scroll to what was already on screen — and a derived list deliberately shows lines from baskets
 *    and shelves that are not. The two producers disagreed about this, so the lane's links changed
 *    meaning the moment the body hydrated.
 */
function groupEntries(
	basket: Basket,
	owner: string,
	families: readonly PurchasableItemGroup[],
	kind: "ticket" | "session",
): BasketListEntry[] {
	return basket.groups
		.filter((group) => families.includes(group.group) && group.itemCount > 0)
		.map((group) => {
			const items = group.itemIds
				.map((id) => basket.items.find((item) => item.id === id))
				.filter((item): item is BasketItem => item !== undefined);
			const parentId = engagementIdOf(items[0]);
			return {
				id: `${kind}:${parentId}`,
				kind,
				label: group.label,
				caption: group.caption,
				itemCount: group.itemCount,
				subtotal: group.subtotal,
				href: basketHref(`${kind}:${parentId}`, owner),
				isDefault: false,
				checkoutable: true,
				// The engagement's own face. `null` when the lines carry none — the lane then draws its
				// category glyph rather than an invented image.
				thumbnail: items.find((item) => item.thumbnail !== null)?.thumbnail ?? null,
			};
		});
}

/**
 * The engagement a line belongs to, by the same rule the server groups on: the project or service it
 * was bought against, falling back to the purchasable itself.
 */
function engagementIdOf(item: BasketItem | undefined): string {
	if (!item) return "unknown";
	const meta = item.metadata;
	if (typeof meta.projectId === "string" && meta.projectId !== "") return meta.projectId;
	if (typeof meta.serviceId === "string" && meta.serviceId !== "") return meta.serviceId;
	return item.itemId;
}

/** The DOM id a body group section is anchored by — the one place the two sides agree on the shape. */
export function groupAnchorId(groupId: string): string {
	return `bsk-group-${groupId}`;
}

/** "4 items" / "1 item" — a count, never a figure. */
function countCaption(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
// #endregion

// #region Category families
/**
 * The category a purchasable family is filed under in the body.
 *
 * Four plain nouns, taken from the SSOT's own `PurchasableItemGroup`, so a new purchasable kind lands
 * in a category by declaring its group rather than by a `switch` growing an arm in this feature.
 */
export function familyLabel(group: PurchasableItemGroup): string {
	switch (group) {
		case "product":
			return "Products";
		case "project":
			return "Tickets";
		case "session":
			return "Sessions";
		case "service":
		default:
			return "Services";
	}
}

/** The item-count breakdown the summary card prints ("9 items: 2 products, 4 tickets, 3 sessions"). */
export interface BasketBreakdown {
	/** The basket's own `itemCount`, verbatim — never a length of a filtered array. */
	total: number;
	/** One part per non-empty family, in the category order the body renders. */
	parts: readonly { key: PurchasableItemGroup; label: string; count: number }[];
}

/** Category order, so the summary's parts and the body's blocks read top-to-bottom in one sequence. */
const FAMILY_ORDER: readonly PurchasableItemGroup[] = ["product", "project", "service", "session"];

/**
 * Count the open basket's ACTIVE lines by family.
 *
 * Counting is not money: these are line tallies over the server's own kind vocabulary, and the total
 * is the server's `itemCount` rather than a length this function derived, so the headline figure is
 * always the one the rest of the surface reports.
 */
export function basketBreakdown(basket: Basket): BasketBreakdown {
	const tally = new Map<PurchasableItemGroup, number>();
	for (const item of basket.items) {
		if (item.savedForLater) continue;
		const family = itemKindMeta(item.itemType).group;
		tally.set(family, (tally.get(family) ?? 0) + 1);
	}
	return {
		total: basket.itemCount,
		parts: FAMILY_ORDER
			.filter((family) => (tally.get(family) ?? 0) > 0)
			.map((family) => ({
				key: family,
				label: familyLabel(family).toLowerCase(),
				count: tally.get(family) ?? 0,
			})),
	};
}
// #endregion

// #region Ticket + session facts
/** One stage a ticket group routes through, and whether its line is currently counted. */
export interface StageStep {
	key: string;
	label: string;
	/** Whether the line carrying this stage is selected AND still buyable. */
	included: boolean;
}

/**
 * The stage checklist of a ticket group.
 *
 * Assembled from each line's SERVER-resolved `stageLabel` — the same string the row prints as its
 * Stage fact — so the checklist can only ever name stages the basket actually holds. A line whose
 * stage has not been chosen yet is deliberately absent: it is already reported as an outstanding fact
 * on its own row, and inventing a "not chosen" step here would report the gap twice.
 */
export function stageChecklist(items: readonly BasketItem[]): StageStep[] {
	const seen = new Set<string>();
	const steps: StageStep[] = [];
	for (const item of items) {
		const label = item.stageLabel;
		if (label === null || seen.has(label)) continue;
		seen.add(label);
		steps.push({
			key: item.id,
			label,
			included: item.isSelectedForCheckout && item.available,
		});
	}
	return steps;
}

/**
 * A booked slot expressed in the READER's own timezone.
 *
 * The server sends the slot in the seller's zone (`scheduledLabel` + `timezone`), which is the fact a
 * seller's calendar states; a buyer three timezones away needs to know when it lands for them. This is
 * a date computation, not a money one, so it is safe to do here — and it deliberately falls back to
 * the server's own label whenever `Intl` cannot resolve the instant, because a slot rendered wrongly
 * is worse than one rendered in the seller's words.
 */
export function localSlotLabel(item: BasketItem): string | null {
	if (item.scheduledAt === null) return null;
	const at = new Date(item.scheduledAt);
	if (Number.isNaN(at.getTime())) return item.scheduledLabel;
	try {
		return new Intl.DateTimeFormat(undefined, {
			weekday: "short",
			day: "numeric",
			month: "short",
			hour: "2-digit",
			minute: "2-digit",
			timeZoneName: "short",
		}).format(at);
	} catch {
		return item.scheduledLabel;
	}
}

/**
 * The conferencing provider a booked session resolves to, when the line carries one.
 *
 * Read from the line's free-form `metadata` and returned only when it is genuinely a string. The
 * basket projection has no conferencing FIELD yet — the provider is settled at the confirmation step
 * (root CLAUDE.md Decision #56 keeps conferencing and calendar sync as two separate capability axes) —
 * so this reports what a line happens to carry and reports nothing otherwise. A fabricated "Zoom"
 * beside a slot is a commitment the platform has not made.
 */
export function conferencingLabel(item: BasketItem): string | null {
	const raw = item.metadata["conferencing"] ?? item.metadata["conferencingProvider"];
	return typeof raw === "string" && raw.trim() !== "" ? raw : null;
}
// #endregion
