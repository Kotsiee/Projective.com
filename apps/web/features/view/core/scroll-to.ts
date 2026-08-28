/**
 * View feature — offset-aware in-page scrolling.
 *
 * Every jump on this surface has to clear chrome that is pinned to the viewport, and how much chrome
 * depends on which shell is hosting the page. Both answers live here so the stage quick-jumps, the
 * rating jump and any future one cannot disagree about where the top of the page is.
 */

/** The buffer between the pinned chrome and the target's first line. */
const BREATHING_ROOM = 16;

/**
 * The height of the chrome a scroll target has to clear.
 *
 * `siteHeaderHeight + middleNavHeaderHeight + extraPadding`, resolved from the shell that is actually
 * rendering — the guest shell pins an ~88px pill header, the authenticated L-shell a 48px top bar.
 *
 * **The band is counted at its FULL height even though it measures 0 right now.** Both sticky header
 * bands reveal by `max-block-size` and are collapsed until the hero scrolls past (§D.7.6), so
 * measuring the live element at click time reads 0 — and then the band opens during the scroll and
 * lands on top of the thing the reader asked to see. Every target these jumps address sits below the
 * hero, so by arrival the band is always open. Reserving it is the correct answer, not a safe guess.
 *
 * Tokens rather than element measurements, for the same reason `EntityHeroProbe` reads them: the guest
 * header morphs to a pill on scroll, so its rendered height mid-transition is not a number worth
 * trusting.
 */
export function chromeOffset(): number {
	try {
		const root = document.documentElement;
		const cs = getComputedStyle(root);
		const rootPx = Number.parseFloat(cs.fontSize) || 16;
		const isGuest = !!document.querySelector(".guest-shell");

		const top = cssLength(
			cs.getPropertyValue(isGuest ? "--site-header-h" : "--shell-topbar-h"),
			rootPx,
			isGuest ? 88 : 48,
		);

		// The band only exists on a route that registered one; `null` means there is nothing to clear.
		const hasBand = !!document.querySelector(
			".guest-shell__subheader, .ui-middle-nav__header",
		);
		const band = hasBand
			? cssLength(cs.getPropertyValue("--shell-midnav-header-h"), rootPx, 48)
			: 0;

		return top + band + BREATHING_ROOM;
	} catch {
		// SSR, or a document that will not answer. A caller's arithmetic still works, just unoffset.
		return 0;
	}
}

/**
 * Scroll `target` into view below the pinned chrome.
 *
 * **Smooth, with a watchdog that guarantees arrival.** A smooth scroll is animation-driven, so it does
 * not run at all in an environment that is not compositing frames — measured in this repo's preview
 * pane at `scrollY` 0 for smooth against 1325 for auto on the same element. Arriving is the FUNCTION
 * of these controls and the smoothness is decoration, and §B.5's rule is that motion may decorate but
 * never carry the outcome; a navigation control that silently leaves the page where it was is the
 * inert-control defect of root CLAUDE.md §3 gate 11.
 *
 * So the request is smooth and a timer checks whether anything moved. It tests "did not move AT ALL"
 * rather than "has not arrived", because a smooth scroll legitimately is mid-flight at that point —
 * testing arrival would snap every animation short.
 *
 * Reduced motion skips straight to `auto`: there the jump IS the accessible behaviour, not a fallback.
 */
export function scrollToElement(target: Element): void {
	try {
		const top = Math.max(
			0,
			target.getBoundingClientRect().top + globalThis.scrollY - chromeOffset(),
		);
		const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
		if (reduced) {
			globalThis.scrollTo({ top, behavior: "auto" });
			return;
		}

		const before = globalThis.scrollY;
		globalThis.scrollTo({ top, behavior: "smooth" });
		// Nothing moved and something should have → this environment does not animate. Land anyway.
		globalThis.setTimeout(() => {
			if (globalThis.scrollY === before && Math.abs(before - top) > 1) {
				globalThis.scrollTo({ top, behavior: "auto" });
			}
		}, 320);
	} catch { /* SSR / no window — nothing to scroll */ }
}

/** Scroll to the element with `id`, if it is in the document. Returns whether it was found. */
export function scrollToId(id: string): boolean {
	try {
		const target = document.getElementById(id);
		if (!target) return false;
		scrollToElement(target);
		return true;
	} catch {
		return false;
	}
}

/**
 * A CSS length in pixels.
 *
 * The shell's height tokens are authored in BOTH `px` and `rem` depending on which sheet declares
 * them, so the unit is resolved rather than assumed: `parseFloat("5.5rem")` is 5, and a 5px offset
 * would put every jump target under the header.
 */
function cssLength(raw: string, rootPx: number, fallback: number): number {
	const value = raw.trim();
	const num = Number.parseFloat(value);
	if (!Number.isFinite(num)) return fallback;
	return value.endsWith("rem") || value.endsWith("em") ? num * rootPx : num;
}
