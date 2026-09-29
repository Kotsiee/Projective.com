import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { recordView } from "../core/view-history.ts";
import type { ExploreEntity } from "../types/explore-types.ts";

/**
 * ViewHistory — the writer behind "Continue where you left off" and the footer's "Recently viewed".
 *
 * It renders NOTHING. One island per page, finding its subjects by attribute rather than being
 * threaded through every card — the same shape as `AmbientPalette`, and for the same reason: the
 * cards are server components and must stay that way, so anything that needs to observe all of them
 * observes the DOM instead of becoming a prop on each.
 *
 * Two modes, and a page may use both:
 *
 * - **Click mode** (no `item`) — a bubble-phase listener on the document records a click on the
 *   stretched link of a card carrying `data-item-id`. Navigation is the click's DEFAULT action, so it
 *   happens after bubbling ends, and `localStorage` is synchronous — the write completes before the
 *   page unloads. Bubble phase rather than capture so that the click a drag-to-scroll track swallows
 *   (it stops propagation in its own capture listener) never reaches here: flinging past a card is
 *   not viewing it.
 * - **Page mode** (`item` given) — records the item this page IS, on mount. This is the truer signal:
 *   opening a listing is a stronger statement than clicking past one, and it is also the only way an
 *   item reached by a deep link or a search result ever enters the history.
 *
 * A middle-click or ⌘-click is recorded too, deliberately. Opening something in a background tab is
 * still opening it, and a reader who fans out five tabs from the feed has told us more about what
 * they are working on than one who clicked once.
 */
export interface ViewHistoryProps {
	/** Record this item on mount — the page's own subject. Omit for the click recorder. */
	item?: { id: string; type: ExploreEntity };
}

export default function ViewHistory({ item }: ViewHistoryProps): JSX.Element | null {
	useEffect(() => {
		if (item?.id) {
			recordView({ id: item.id, type: item.type });
			return;
		}

		const onClick = (e: MouseEvent) => {
			const target = e.target;
			if (!(target instanceof Element)) return;
			const card = target.closest<HTMLElement>("[data-item-id][data-item-type]");
			const id = card?.dataset.itemId;
			const type = card?.dataset.itemType as ExploreEntity | undefined;
			if (!id || !type) return;
			// Only the card's own stretched link opens the item. The whitespace between the title and the
			// price navigates nowhere, and a sub-anchor — the creator's profile, a skill filter — goes
			// somewhere ELSE, so neither is a view of this item.
			if (!target.closest("a[href]")?.classList.contains("ex-card__link")) return;
			recordView({ id, type });
		};

		document.addEventListener("click", onClick);
		return () => document.removeEventListener("click", onClick);
	}, [item?.id]);

	return null;
}
