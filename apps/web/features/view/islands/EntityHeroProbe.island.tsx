import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { viewHeaderCondensed } from "../core/view-state.ts";

/**
 * EntityHeroProbe — the scroll sentinel that drives the migrated sticky header (§D.7.6).
 *
 * `EntityViewPage` is a SERVER component and the hero has no island of its own, so the probe is a
 * zero-UI island rendered as the hero's last child. It flips the shared {@link viewHeaderCondensed}
 * signal, which `EntityStickyHeader` in the middle-nav header band reads to reveal itself.
 *
 * **Why a scroll listener and not an IntersectionObserver.** An observer is the more efficient
 * mechanism — no per-event layout read, work done off the main thread — and it was built that way
 * first. It was replaced deliberately. This repo's preview harness does not composite, and in it
 * BOTH observer callbacks and `scroll` events measure zero occurrences while `scrollY` moves
 * normally, so neither mechanism can be verified here. Faced with two unverifiable options, the right
 * one is the one the product already ships and runs in production on the profile and project views —
 * not the one that is theoretically nicer. The observer can replace this once there is somewhere to
 * prove it works.
 *
 * **`measure()` runs once on mount, before any event.** That is what makes the initial state correct
 * even if no scroll event ever arrives — a deep link into the middle of a page, a restored scroll
 * position, or an environment that throttles events. An observer-only version has no equivalent.
 *
 * **The chrome height branches per shell**, which is the one real improvement over the precedent it
 * copies. The band is pinned beneath the sticky chrome, so the crossing that matters is "went under
 * the chrome", not "left the viewport" — and the authed frame pins at `--shell-topbar-h` (48px) while
 * the guest shell pins at `--site-header-h` (~88px). Reading one and applying it to both condenses
 * the guest band ~40px late, which reads as lag rather than a bug and is correspondingly hard to spot.
 */
export default function EntityHeroProbe(): JSX.Element {
	const sentinel = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = sentinel.current;
		if (!el) return;

		// Which chrome this page is pinned under — the guest shell and the authed frame differ.
		const isGuest = !!document.querySelector(".guest-shell");
		const root = document.documentElement;
		const raw = getComputedStyle(root)
			.getPropertyValue(isGuest ? "--site-header-h" : "--shell-topbar-h")
			.trim();
		// The tokens are authored in both px and rem, so resolve the unit rather than assuming one:
		// `parseInt("5.5rem")` is 5, and the band would then condense almost immediately and never settle.
		const rootPx = Number.parseFloat(getComputedStyle(root).fontSize) || 16;
		const num = Number.parseFloat(raw) || (isGuest ? 88 : 48);
		const threshold = (raw.endsWith("rem") ? num * rootPx : num) + 24;

		const measure = (): void => {
			const node = sentinel.current;
			if (!node) return;
			viewHeaderCondensed.value = node.getBoundingClientRect().top <= threshold;
		};

		measure();
		globalThis.addEventListener("scroll", measure, { passive: true });
		globalThis.addEventListener("resize", measure);
		return () => {
			globalThis.removeEventListener("scroll", measure);
			globalThis.removeEventListener("resize", measure);
			// Leaving must not strand the band open — the signal is module-level, so a same-tab
			// navigation into a listing whose header band is `null` would otherwise inherit `true`.
			viewHeaderCondensed.value = false;
		};
	}, []);

	return <div ref={sentinel} class="evp-hero__probe" aria-hidden="true" />;
}
