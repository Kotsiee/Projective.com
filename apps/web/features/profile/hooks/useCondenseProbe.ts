import type { RefObject } from "preact";
import { useEffect } from "preact/hooks";
import { profileHeaderCondensed } from "../core/profile-state.ts";

/**
 * useCondenseProbe — the scroll sentinel that drives the profile's migrated sticky header.
 *
 * Attached to the hero's action rig. The band in the shell's header slot reveals the moment the
 * rig's bottom edge scrolls up under the line the band pins to — so the controls the reader just
 * lost come back exactly where they went, and the two copies of the filled Hire are never on
 * screen together (the §B.8.2 exemption is "mutually exclusive by render condition", and this
 * probe is what makes it true).
 *
 * **Why a scroll listener and not an IntersectionObserver.** The observer is the more efficient
 * mechanism, and it is not what ships, for the reason `EntityHeroProbe` records: this repo's
 * preview harness composites no frames, and in it BOTH observer callbacks and `scroll` events
 * measure zero occurrences while `scrollY` moves normally — so neither can be verified here, and the
 * right choice is the one the product already runs on the entity view. `measure()` also runs once on
 * mount, before any event, which is what makes the initial state correct for a deep link into the
 * middle of the page or a restored scroll position.
 *
 * **The line is measured off the band itself, never assumed.** The band pins at the top-bar line in
 * the authenticated frame (48px) and at the site-header band in the guest shell (88px) — and where
 * it is `display: none` (a guest phone) its rect is all zeros, which condenses nothing. Reading the
 * element rather than a token means the probe stays right if either shell moves its chrome.
 *
 * **The hysteresis is the band's own height, and it is load-bearing.** In the authenticated frame
 * the band lives in a grid row that GROWS as it reveals, so the whole page — this rig included —
 * shifts down by the band's height the moment it condenses. A single threshold then oscillates: the
 * rig crosses the line, the band reveals, the shift pushes the rig back below the line, the band
 * collapses, the rig crosses again. So the rule to LEAVE the condensed state sits one band-height
 * below the rule to ENTER it. The guest band is `position: fixed` and shifts nothing, so it takes a
 * small margin instead — enough to keep the edge from chattering, not enough to show both rigs.
 */
export function useCondenseProbe(rig: RefObject<HTMLElement>): void {
	useEffect(() => {
		const el = rig.current;
		if (!el) return;

		const root = document.documentElement;
		const isGuest = !!document.querySelector(".guest-shell");
		const rootPx = Number.parseFloat(getComputedStyle(root).fontSize) || 16;
		const bandH = resolveLength(
			getComputedStyle(root).getPropertyValue("--shell-midnav-header-h"),
			rootPx,
			48,
		);
		const slack = isGuest ? GUEST_SLACK_PX : bandH;

		const pinLine = (): number => {
			const band = document.querySelector<HTMLElement>(".pf-band");
			if (band) return band.getBoundingClientRect().top;
			// No band mounted (nothing to reveal) — the chrome line is the honest fallback.
			const raw = getComputedStyle(root).getPropertyValue(
				isGuest ? "--site-header-h" : "--shell-topbar-h",
			);
			return resolveLength(raw, rootPx, isGuest ? 88 : 48);
		};

		const measure = (): void => {
			const node = rig.current;
			if (!node) return;
			const bottom = node.getBoundingClientRect().bottom;
			const line = pinLine();
			profileHeaderCondensed.value = profileHeaderCondensed.peek()
				? bottom <= line + slack
				: bottom <= line;
		};

		measure();
		globalThis.addEventListener("scroll", measure, { passive: true });
		globalThis.addEventListener("resize", measure);
		return () => {
			globalThis.removeEventListener("scroll", measure);
			globalThis.removeEventListener("resize", measure);
			// Leaving must not strand the band open — the signal is module-level.
			profileHeaderCondensed.value = false;
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
