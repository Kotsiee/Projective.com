import type { JSX } from "preact";
import type { HrefContext } from "@features/explore/core/routing.ts";
import ExploreBackNav from "@features/explore/islands/ExploreBackNav.island.tsx";
import { backHrefFor, backLabelFor } from "../core/view-model.ts";

export interface BackLinkProps {
	/** Where the page was opened from — Explore, or the seller's profile-scoped namespace. */
	ctx: HrefContext;
	/**
	 * `page` — the static control at the top of the frame, above the fold.
	 * `band` — the same control inside the migrated sticky header, revealed once the hero scrolls away.
	 */
	placement: "page" | "band";
}

/**
 * BackLink — the ONE way out of an entity view, rendered by the page and by the migrated sticky
 * header from a single component so the two homes cannot drift (same destination, same label, same
 * glyph).
 *
 * The control itself is the Explore tree's contextual `ExploreBackNav`: a real anchor to
 * `backHrefFor(ctx)` — Explore, or the profile a listing sits under — until hydration, and then to the
 * exact page of the tree the visitor came from, filters intact (`explore-history.ts`). So it works
 * with JavaScript off, on a middle-click and in a new tab, and it still lands on the search the
 * reader left rather than on a bare `/explore`.
 *
 * Only one of the two placements is ever reachable: the page copy withdraws (`visibility`) the
 * moment the band reveals, and the band is itself gated the same way while collapsed, so a keyboard
 * or screen-reader user meets exactly one "Back" on the page whatever the scroll position (§D.7.4 —
 * moved, not duplicated). This component owns the PLACEMENT class only; the control's colour, hover
 * and RTL glyph flip are `back-nav.css`'s.
 */
export function BackLink({ ctx, placement }: BackLinkProps): JSX.Element {
	return (
		<ExploreBackNav
			variant="text"
			fallback={backHrefFor(ctx)}
			fallbackLabel={backLabelFor(ctx)}
			class={`evp__back evp__back--${placement}`}
		/>
	);
}
