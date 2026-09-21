import type { JSX } from "preact";
import ExploreBackNav from "@features/explore/islands/ExploreBackNav.island.tsx";

export interface MigratingBackProps {
	/**
	 * `page` — the static control near the top of the content area, above the fold.
	 * `band` — the same control inside the migrated sticky header, revealed once the anchor
	 * scrolls away (`hooks/useMigratingHeader.ts`).
	 */
	placement: "page" | "band";
	/** The server-rendered destination: the tree's root, or the profile a listing sits under. */
	fallback: string;
	/** The accessible name for the fallback ("Back to Explore" / "Back to profile"). */
	fallbackLabel: string;
	/** Extra class(es) — the host's own placement (a grid area, a margin). */
	class?: string;
}

/**
 * MigratingBack — the ONE way out of a surface that registers a scroll-migrated sticky header
 * (`DESIGN_SYSTEM.md` §D.7.6): rendered by the page and by the band from a single component, so
 * the two homes cannot drift (same destination, same label, same glyph).
 *
 * The control itself is the Explore tree's contextual `ExploreBackNav`: a real anchor to
 * `fallback` until hydration, and then to the exact page of the tree the visitor came from, filters
 * intact (`explore-history.ts`). So it works with JavaScript off, on a middle-click and in a new
 * tab, and it still lands on the search the reader left rather than on a bare `/explore`.
 *
 * Two presentations of one control: the page copy is the arrow + the word "Back" in the meta
 * register; the band copy is the compact circle (§B.6 — a 48px chrome strip has no room for a
 * word beside an identity and a rig), with the destination in a portal `Tooltip` + `aria-label`.
 *
 * Only one of the two placements is ever reachable: the page copy withdraws (`visibility`) the
 * moment the band reveals — `:root[data-header-condensed]`, written by the probe — and the band is
 * itself gated the same way while collapsed, so a keyboard or screen-reader user meets exactly one
 * "Back" on the page whatever the scroll position (§D.7.4 — moved, not duplicated). Focus follows
 * the hand-over (`core/migrating-header.ts`). This component owns the PLACEMENT class only; the
 * control's colour, hover and RTL glyph flip are `back-nav.css`'s, and the withdrawal and the
 * entrance are `migrating-back.css`'s.
 */
export function MigratingBack(
	{ placement, fallback, fallbackLabel, class: className }: MigratingBackProps,
): JSX.Element {
	const classes = `shell-back shell-back--${placement}${className ? ` ${className}` : ""}`;
	return (
		<ExploreBackNav
			variant={placement === "band" ? "icon" : "text"}
			fallback={fallback}
			fallbackLabel={fallbackLabel}
			class={classes}
		/>
	);
}
