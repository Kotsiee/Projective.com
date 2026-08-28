import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import { Tooltip } from "@projective/ui/feedback";
import type { HrefContext } from "@features/explore/core/routing.ts";
import { backHrefFor, backLabelFor } from "../core/view-model.ts";

/**
 * EntityNavRail — the authenticated shell's middle-nav lane on a commerce `/view` route.
 *
 * It carries exactly one control: the way out. The conversion rail is the page's END column
 * (`EntityLane`, §D.7), so the shell's lane has no transaction to hold and no list to navigate — and a
 * lane opened to 280px to hold a single 48px button is 232px of the content region spent on nothing.
 * It therefore renders at the collapsed rail width and stays there; `viewLaneOptionsFor` pins the
 * splitter to that width and `entity-view.css` withholds the drag handle, because a handle that can
 * only be dragged back to where it already is is a control whose only outcome is no outcome (root
 * CLAUDE.md §3 gate 11).
 *
 * **The duty transfers, it is not duplicated.** The in-page `.evp-navstrip` carries the same link for a
 * GUEST, whose shell has no middle-nav lane at all; on the authenticated shell that strip is not
 * rendered, so exactly one back control is ever in the accessibility tree (§D.7.4 applied to
 * navigation rather than to the offer).
 *
 * A real anchor with a real `href`, so middle-click and open-in-new-tab work, and a portal `Tooltip`
 * rather than a native `title` (§B.8.5) — the glyph says "back" but not back to WHAT, and that differs
 * between the Explore namespace and a seller's profile.
 */
export interface EntityNavRailProps {
	/** Where "back" goes — Explore, or the seller's profile in the profile-scoped namespace. */
	ctx: HrefContext;
}

export function EntityNavRail({ ctx }: EntityNavRailProps): JSX.Element {
	const label = backLabelFor(ctx);
	return (
		<nav class="evp-navrail" aria-label="Listing navigation">
			<Tooltip content={label} placement="right">
				<a class="evp-navrail__back" href={backHrefFor(ctx)} aria-label={label}>
					<Icon name="arrow-left" size="md" aria-hidden />
				</a>
			</Tooltip>
		</nav>
	);
}
