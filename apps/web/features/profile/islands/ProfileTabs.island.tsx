import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import "../styles/profile.css";
import { TAB_LABEL, tabHref, tabsFor } from "../core/profile-model.ts";
import { noteTabScroll, tabScrollLanding, takeTabScroll } from "../core/tab-scroll.ts";
import { headerCondensed } from "@features/shell/core/migrating-header.ts";
import type { ProfileTab, ProfileView } from "../types/profile-types.ts";

/**
 * ProfileTabs — the four-section tab bar (root CLAUDE.md §8 Decision #96): Work · Experience ·
 * Reviews · Posts, each a real anchor into its `/[handle]/<section>` sub-route (URL-driven active
 * state, so deep-links and refresh land right). Underlined text tabs on one shared hairline (§B.4 /
 * §D.4): the active tab carries a 2px `--on-surface` underline — monochrome, never the brand teal.
 *
 * # Two states, one box
 *
 * In flow (**unstuck**) the bar is a full-width strip: transparent, sharp-cornered, closed by the
 * one hairline the tabs' underline lands on. Once it has scrolled up to its pinned line — a small
 * gap beneath the migrated header band — it is **stuck**, and the strip lets go of its hairline
 * while the pill around the tabs takes on the band's own glass: the same veil, blur and hairline
 * as `ui-middle-nav__header`, plus the elevation a thing that genuinely floats over scrolling
 * content is owed (§B.4.3, on a `::before` underlay). Nothing about the BOX changes between the
 * two — the pill is the tabs' own content width in both states and only its decoration moves — so
 * the transition costs no layout and the page beneath never shifts (CLS 0 by construction; the
 * pinned line itself is a CSS length, `--pf-tabs-top`, read from the shell's own chrome tokens).
 *
 * # Why an island
 *
 * CSS has no `:stuck`. A zero-height sentinel sits where the bar's natural position is, and the
 * bar is stuck exactly when that sentinel has scrolled above the bar's pinned line — read from the
 * bar's own computed `top`, so this never restates the offset the stylesheet owns. Measured on
 * mount (a deep link, a restored scroll), on every scroll and resize, and once more a beat after
 * the header band reveals or collapses: in the authenticated frame that reveal grows the band's
 * grid row and shifts the whole page beneath it, which moves the sentinel with no scroll event to
 * say so. The stuck flag toggles `data-stuck`, and the stylesheet does the rest.
 *
 * (Why a scroll listener and not an IntersectionObserver: the same reason as every scroll probe on
 * this surface — see `@features/shell/hooks/useMigratingHeader.ts`.)
 *
 * # Switching a tab keeps the reader's place
 *
 * A tab is a full document load, which the browser starts at the top. The leaving page records its
 * scroll position and the bar's pinned offset as the anchor navigates (`noteTabScroll`); the
 * arriving page reads the note in a LAYOUT effect — before the first paint the reader sees — and
 * lands by `tabScrollLanding`'s rule: the same position when the new section still reaches it,
 * otherwise the top of the tab container, settled to smoothly (jump-to-final under reduced motion).
 * Only a fresh `navigate` is handled; a back ⁄ forward traversal is the browser's own restoration.
 */
export interface ProfileTabsProps {
	profile: ProfileView;
	active: ProfileTab | null;
}

/** How long after the band flips to re-measure — past the band's reveal transition. */
const RESETTLE_MS = 320;

export default function ProfileTabs({ profile, active }: ProfileTabsProps): JSX.Element {
	const tabs = tabsFor(profile.kind);
	const sentinel = useRef<HTMLDivElement>(null);
	const bar = useRef<HTMLElement>(null);
	const stuck = useSignal(false);

	/** The pinned line, as the stylesheet resolved it (`inset-block-start` → computed `top`, in px). */
	const pinnedLine = (): number | null => {
		const nav = bar.current;
		if (!nav) return null;
		const pinned = Number.parseFloat(getComputedStyle(nav).top);
		return Number.isFinite(pinned) ? pinned : null;
	};

	/** The bar's natural document offset — the one number every section of a profile shares. */
	const barTop = (): number | null => {
		const mark = sentinel.current;
		if (!mark) return null;
		return mark.getBoundingClientRect().top + globalThis.scrollY;
	};

	const measure = (): void => {
		const mark = sentinel.current;
		const pinned = pinnedLine();
		if (!mark || pinned === null) return;
		stuck.value = mark.getBoundingClientRect().top < pinned - 0.5;
	};

	/** The leaving half: written on the anchor's click, before the document unloads. */
	const leave = (e: MouseEvent, tab: ProfileTab): void => {
		// A modified or non-primary click opens a new tab ⁄ window, which starts at the top by right.
		if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
			return;
		}
		if (tab === active) return;
		const top = barTop();
		if (top === null) return;
		noteTabScroll({
			handle: profile.handle,
			offset: globalThis.scrollY - top,
			at: Date.now(),
		});
	};

	// The arriving half — a LAYOUT effect, so the landing is set before the first frame the reader
	// sees rather than after a paint at the top of the page.
	useLayoutEffect(() => {
		const note = takeTabScroll();
		if (!note || note.handle !== profile.handle) return;
		const nav = performance.getEntriesByType("navigation")[0] as
			| PerformanceNavigationTiming
			| undefined;
		if (nav && nav.type !== "navigate") return;
		const root = document.documentElement;
		const land = () => {
			const top = barTop();
			const pinned = pinnedLine();
			if (top === null || pinned === null) return null;
			const maxScroll = Math.max(0, root.scrollHeight - globalThis.innerHeight);
			return { barTop: top, landing: tabScrollLanding(note, { barTop: top, pinned, maxScroll }) };
		};
		const first = land();
		if (!first) return;
		// The instant placement: the reader's own position, or (anchor mode) the nearest this document
		// reaches, from which the settle below travels.
		globalThis.scrollTo({ top: first.landing.from ?? first.landing.top, behavior: "auto" });

		/*
		 * HOLD the placement while the page's geometry is still arriving, then settle.
		 *
		 * The bar's document offset is not final at hydration: the header band reveals (and, in the
		 * authenticated frame, grows its grid row and pushes everything beneath it down) BECAUSE this
		 * placement scrolled the hero away, and in development the island's stylesheet can land a
		 * frame after the island does. Each frame the offset is re-read and, while it keeps moving, the
		 * placement is re-applied AGAINST it — the reader's distance from the bar is what the note
		 * carries, so the same content stays under their eyes as the page shifts. Once the document
		 * has finished loading AND the offset has held still for a few frames (or the budget is spent)
		 * the anchor-mode settle runs: a smooth scroll to the top of the tab container, jump-to-final
		 * under either reduced-motion channel — read at that instant, because the hook that resolves
		 * them lands in an effect after this one. The reader's own first input ends the hold at once:
		 * a page that keeps re-placing itself under a wheel that is already turning is worse than one
		 * that landed a few pixels off.
		 */
		const STABLE_FRAMES = 4;
		const BUDGET_MS = 3000;
		const started = performance.now();
		let last = first.barTop;
		let still = 0;
		let frame = 0;
		let completeSince: number | null = null;
		let released = false;
		const release = () => {
			released = true;
		};
		const INPUTS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
		for (const type of INPUTS) globalThis.addEventListener(type, release, { passive: true });
		const unlisten = () => {
			for (const type of INPUTS) globalThis.removeEventListener(type, release);
		};
		const tick = () => {
			if (released) return unlisten();
			const now = land();
			if (!now) return unlisten();
			if (Math.abs(now.barTop - last) > 0.5) {
				last = now.barTop;
				still = 0;
				globalThis.scrollTo({ top: now.landing.from ?? now.landing.top, behavior: "auto" });
			} else {
				still++;
			}
			// Stability counts only from the frame the document finished loading: the stylesheets a
			// development server injects arrive with that flip, and a bar that held still for four
			// unstyled frames has not held still at all.
			if (document.readyState === "complete" && completeSince === null) {
				completeSince = performance.now();
				still = 0;
			}
			const settled = completeSince !== null && still >= STABLE_FRAMES;
			if (!settled && performance.now() - started < BUDGET_MS) {
				frame = requestAnimationFrame(tick);
				return;
			}
			unlisten();
			if (now.landing.mode !== "anchor") return;
			const noMotion = (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
				false) || root.dataset.motion === "reduced";
			globalThis.scrollTo({ top: now.landing.top, behavior: noMotion ? "auto" : "smooth" });
		};
		frame = requestAnimationFrame(tick);
		return () => {
			cancelAnimationFrame(frame);
			unlisten();
		};
	}, []);

	useEffect(() => {
		measure();
		globalThis.addEventListener("scroll", measure, { passive: true });
		globalThis.addEventListener("resize", measure);
		return () => {
			globalThis.removeEventListener("scroll", measure);
			globalThis.removeEventListener("resize", measure);
		};
	}, []);

	// The band's reveal moves the page (authenticated frame) without a scroll event.
	useSignalEffect(() => {
		void headerCondensed.value;
		const id = setTimeout(measure, RESETTLE_MS);
		return () => clearTimeout(id);
	});

	return (
		<div class="pf-tabsdock">
			<div ref={sentinel} class="pf-tabs__sentinel" aria-hidden="true" />
			<nav
				ref={bar}
				class="pf-tabs"
				data-stuck={stuck.value ? "true" : "false"}
				aria-label="Profile sections"
			>
				<div class="pf-tabs__pill">
					<ul class="pf-tabs__list" role="list">
						{tabs.map((tab) => {
							const isActive = active === tab;
							return (
								<li class="pf-tabs__item" key={tab}>
									<a
										class="pf-tab"
										href={tabHref(profile.handle, tab)}
										data-active={isActive ? "true" : undefined}
										aria-current={isActive ? "page" : undefined}
										onClick={(e) => leave(e, tab)}
									>
										{TAB_LABEL[tab]}
									</a>
								</li>
							);
						})}
					</ul>
				</div>
			</nav>
		</div>
	);
}
