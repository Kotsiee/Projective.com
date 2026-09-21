import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import type { HrefContext } from "@features/explore/core/routing.ts";
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
 * header from a single component so the two homes cannot drift (same href, same label, same glyph).
 *
 * Only one of the two is ever reachable: the page copy withdraws (`visibility`) the moment the band
 * reveals, and the band is itself gated the same way while collapsed, so a keyboard or screen-reader
 * user meets exactly one "Back" on the page whatever the scroll position (§D.7.4 — moved, not
 * duplicated). It is a real anchor with a real href, so middle-click and open-in-new-tab work and a
 * no-JS reader still has the route back.
 */
export function BackLink({ ctx, placement }: BackLinkProps): JSX.Element {
	return (
		<a class={`evp__back evp__back--${placement}`} href={backHrefFor(ctx)}>
			<Icon name="arrow-left" size="sm" aria-hidden />
			<span>{backLabelFor(ctx)}</span>
		</a>
	);
}
