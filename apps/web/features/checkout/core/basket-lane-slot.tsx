import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import BasketListLane from "../islands/BasketListLane.island.tsx";
import { checkoutStepHref, checkoutStepOf, isCheckoutPath, isFocusStep } from "./basket-model.ts";
import { resolveBasket } from "./checkout-ssr.ts";
import type {
	Basket,
	BasketListEntry,
	BasketLists,
	BasketSummary,
} from "../types/checkout-types.ts";

/**
 * basket-lane-slot — the SSR-idiomatic resolver for the middle-nav LANE on a checkout route (mirrors
 * `walletLaneFor` / `catalogueLaneFor`).
 *
 * **It returns `null` on the two focus steps**, and the narrowing happens HERE rather than in the
 * layout for a mechanical reason: `laneFor` can never return `null` — `sectionLane()` is its
 * unconditional fallback — so a "no lane on a focus step" branch added after the checkout branch
 * would be unreachable dead code that reviews as a fix.
 *
 * `UserShell` already discards the lane in focus chrome, so a lane leaking through would not be a
 * visual defect. It would be a wasted `resolveBasket` on every request and an island tree built only
 * to be thrown away — and, worse, a second answer to a question the chrome resolver has already
 * answered.
 *
 * **The lane DOES render on the confirmation step**, which is not an oversight. That step runs in full
 * chrome, and `.ui-middle-nav` widens the frame's seam accumulator by `--shell-lane-w`
 * unconditionally; a full-chrome frame with no lane would sit its three fixed tracers 280px inboard.
 * The focus steps escape that through `[data-chrome="focus"]`'s own override. A buyer who has just
 * paid also still has other lists, and the lane is the only thing that navigates between them.
 *
 * Server-only (reaches `@server/services`); never imported by an island.
 */
export function basketLaneFor(url: URL, context: UserContext): ComponentChildren {
	if (!isCheckoutPath(url.pathname)) return null;

	const step = checkoutStepOf(url.pathname);
	if (isFocusStep(step)) return null;

	const { basket, baskets, owner, display } = resolveBasket(context, url);

	return (
		<BasketListLane
			lists={listsFrom(basket, baskets, owner)}
			activeBasketId={basket.id || null}
			owner={owner}
			display={display}
			step={step}
			unavailableCount={basket.unavailableCount}
		/>
	);
}

/**
 * The lane's navigation model, RESHAPED from the basket read.
 *
 * ⚠ **Bridge, not the destination.** `BasketLists` is a fat-service projection
 * (`BasketBackendService.lists` → `resolveBasketLists`), computed in one pass precisely so the three
 * sections cannot disagree about which list a line belongs to. Until that resolver lands this reshapes
 * what the basket read already returned, and the moment it does this whole function is replaced by a
 * single `resolveBasketLists(context, url)` call.
 *
 * It is a reshape and not a derivation: every figure is a server-computed `MoneyView` copied verbatim
 * and every grouping is the server's own `basket.groups`. Nothing here sums, converts or formats — a
 * lane that totalled its own rows would be a second answer to what the buyer owes.
 */
function listsFrom(basket: Basket, baskets: BasketSummary[], owner: string): BasketLists {
	const activeId = basket.id || null;

	const lists: BasketListEntry[] = baskets.map((entry) => ({
		id: entry.id,
		kind: "basket",
		label: entry.name,
		caption: null,
		itemCount: entry.itemCount,
		subtotal: entry.subtotal,
		href: checkoutStepHref("basket", entry.id, owner),
		isDefault: entry.isDefault,
		checkoutable: true,
		thumbnail: null,
	}));

	// The parked shelf is a real destination but never a checkout: parking a line is the buyer saying
	// "not now", so offering to pay for the shelf would contradict the act that put it there.
	if (basket.savedForLaterCount > 0) {
		lists.push({
			id: "saved",
			kind: "saved",
			label: "Saved for later",
			caption: null,
			itemCount: basket.savedForLaterCount,
			subtotal: basket.subtotal,
			href: `${checkoutStepHref("basket", activeId, owner)}#saved`,
			isDefault: false,
			checkoutable: false,
			thumbnail: null,
		});
	}

	const derived = (
		family: "project" | "service" | "session",
		kind: "ticket" | "session",
	): BasketListEntry[] =>
		basket.groups
			.filter((group) => group.group === family)
			.map((group) => ({
				id: group.id,
				kind,
				label: group.label,
				caption: group.caption,
				itemCount: group.itemCount,
				subtotal: group.subtotal,
				href: group.href ?? checkoutStepHref("basket", activeId, owner),
				isDefault: false,
				checkoutable: true,
				thumbnail: null,
			}));

	return {
		lists,
		// A ticket belongs to the engagement that will execute it, which is a project for a pipeline
		// ticket and a service for a productised one — both are ticket work to the buyer.
		tickets: [...derived("project", "ticket"), ...derived("service", "ticket")],
		sessions: derived("session", "session"),
		activeId,
		activeSubtotal: basket.net,
		activeCheckoutHref: checkoutStepHref("details", activeId, owner),
	};
}
