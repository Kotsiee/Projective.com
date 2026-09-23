import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import type { ReadActor } from "@server/services/read-actor.ts";
import BasketListLane from "../islands/BasketListLane.island.tsx";
import { checkoutStepOf, isCheckoutPath, isFocusStep } from "./basket-model.ts";
import { resolveBasket, resolveBasketLists } from "./checkout-ssr.ts";

/**
 * basket-lane-slot — the SSR-idiomatic resolver for the middle-nav LANE on a checkout route (mirrors
 * `walletLaneFor` / `catalogueLaneFor`).
 *
 * **It returns `null` on the two focus steps**, and the narrowing happens HERE rather than in the
 * layout for a mechanical reason: `laneFor` can never return `null` — `sectionLane()` is its
 * unconditional fallback — so a "no lane on a focus step" branch added after the checkout branch
 * would be unreachable dead code that reviews as a fix.
 *
 * **The lane DOES render on the confirmation step**, which is not an oversight. That step runs in full
 * chrome, and `.ui-middle-nav` widens the frame's seam accumulator by `--shell-lane-w`
 * unconditionally; a full-chrome frame with no lane would sit its three fixed tracers 280px inboard.
 * A buyer who has just paid also still has other lists, and the lane is the only thing that navigates
 * between them.
 *
 * The navigation model is the fat service's own (`BasketBackendService.lists`), computed in one pass
 * so the lists, the parked shelf and the engagement-derived groups cannot disagree about a line — the
 * same projection the lane's island refetches, so the first byte and the refresh are one shape.
 *
 * Server-only (reaches `@server/services`); never imported by an island.
 */
export async function basketLaneFor(
	url: URL,
	context: UserContext,
	actor: ReadActor,
): Promise<ComponentChildren> {
	if (!isCheckoutPath(url.pathname)) return null;

	const step = checkoutStepOf(url.pathname);
	if (isFocusStep(step)) return null;

	const [{ basket, owner, display }, lists] = await Promise.all([
		resolveBasket(context, url, actor),
		resolveBasketLists(context, url, actor),
	]);

	return (
		<BasketListLane
			lists={lists}
			activeBasketId={basket.id || null}
			owner={owner}
			display={display}
			step={step}
			unavailableCount={basket.unavailableCount}
		/>
	);
}
