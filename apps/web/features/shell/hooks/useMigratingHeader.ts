import type { RefObject } from "preact";
import { useEffect } from "preact/hooks";
import {
	clearHeaderCondensed,
	headerCondensed,
	reflectHeaderCondensed,
} from "../core/migrating-header.ts";

/**
 * useMigratingHeader — the scroll probe that drives the shell's scroll-migrated sticky header
 * (`DESIGN_SYSTEM.md` §D.7.6), shared by the entity view and the profile.
 *
 * Attach it to the ANCHOR — the region the band condenses: the entity view's hero (a zero-height
 * sentinel as its last child, so the anchor's bottom IS the hero's bottom), the profile hero's
 * action rig. The band in the shell's header slot reveals the moment the anchor's bottom edge
 * scrolls up under the line the band pins to, and the page's copy of the back control withdraws in
 * the same write (`reflectHeaderCondensed`), so the way out moves into the band rather than being
 * duplicated beside it (§D.7.4). For the profile that threshold is also what keeps §B.8.2 whole —
 * the two copies of the filled Hire are never on screen together.
 *
 * **Why a scroll listener and not an IntersectionObserver.** The observer is the more efficient
 * mechanism, and it is not what ships: this repo's preview harness composites no frames, and in it
 * BOTH observer callbacks and `scroll` events measure zero occurrences while `scrollY` moves
 * normally — so neither can be verified there, and the right choice is the one the product already
 * runs. `measure()` also runs once on mount, before any event, which is what makes the initial
 * state correct for a deep link into the middle of a page or a restored scroll position.
 *
 * **The line is measured off the band itself, never assumed.** The band pins at the top-bar line
 * in the authenticated frame (48px) and at the site-header band in the guest shell (88px). Reading
 * the element rather than a token means the probe stays right if either shell moves its chrome.
 *
 * **No band, no condensing.** Where the band is not rendered, or is `display: none` (the guest
 * sub-header below 768px), nothing can take the back control over — so the probe never condenses,
 * and the page copy stays where it is. This replaces a per-surface CSS exception that re-showed
 * the page copy on exactly that shell at exactly that width, which is the kind of rule that is
 * right until the breakpoint moves.
 *
 * **The hysteresis is the band's own height, and it is load-bearing.** In the authenticated frame
 * the band lives in a grid row that GROWS as it reveals, so the whole page — the anchor included —
 * shifts down by the band's height the moment it condenses. A single threshold then oscillates:
 * the anchor crosses the line, the band reveals, the shift pushes the anchor back below the line,
 * the band collapses, the anchor crosses again. So the rule to LEAVE the condensed state sits one
 * band-height below the rule to ENTER it. (Chromium's scroll anchoring compensates the shift on
 * `scrollY`; Safari has no anchoring, which is why the hysteresis cannot be dropped.) The guest band
 * is `position: fixed` and shifts nothing, so it takes a small margin instead — enough to keep the
 * edge from chattering, not enough to show both copies.
 */
export function useMigratingHeader(anchor: RefObject<HTMLElement>): void {
	useEffect(() => {
		if (!anchor.current) return;

		const root = document.documentElement;
		const isGuest = !!document.querySelector(".guest-shell");
		const rootPx = Number.parseFloat(getComputedStyle(root).fontSize) || 16;
		const bandH = resolveLength(
			getComputedStyle(root).getPropertyValue("--shell-midnav-header-h"),
			rootPx,
			48,
		);
		const slack = isGuest ? GUEST_SLACK_PX : bandH;

		// The band's pinned line, or `null` when there is no rendered band to reveal.
		const pinLine = (): number | null => {
			const band = document.querySelector<HTMLElement>(".pf-stickyhead");
			if (!band || band.getClientRects().length === 0) return null;
			return band.getBoundingClientRect().top;
		};

		const measure = (): void => {
			const node = anchor.current;
			if (!node) return;
			const line = pinLine();
			if (line === null) {
				reflectHeaderCondensed(false);
				return;
			}
			const bottom = node.getBoundingClientRect().bottom;
			reflectHeaderCondensed(headerCondensed.peek() ? bottom <= line + slack : bottom <= line);
		};

		measure();
		globalThis.addEventListener("scroll", measure, { passive: true });
		globalThis.addEventListener("resize", measure);
		return () => {
			globalThis.removeEventListener("scroll", measure);
			globalThis.removeEventListener("resize", measure);
			clearHeaderCondensed();
		};
	}, []);
}

/** The guest band overlays the page, so its hysteresis only has to stop the edge chattering. */
const GUEST_SLACK_PX = 8;

/**
 * A CSS length token as pixels. The tokens are authored in both `px` and `rem`, so the unit is
 * resolved rather than assumed: `parseInt("3rem")` is 3, and a threshold of 3px would condense the
 * band almost immediately and never settle.
 */
function resolveLength(raw: string, rootPx: number, fallback: number): number {
	const value = raw.trim();
	const num = Number.parseFloat(value);
	if (!Number.isFinite(num)) return fallback;
	return value.endsWith("rem") ? num * rootPx : num;
}
