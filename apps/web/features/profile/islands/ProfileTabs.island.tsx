import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/profile.css";
import { TAB_LABEL, tabHref, tabsFor } from "../core/profile-model.ts";
import { profileHeaderCondensed } from "../core/profile-state.ts";
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
 * this surface — see `hooks/useCondenseProbe.ts`.)
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

	const measure = (): void => {
		const mark = sentinel.current;
		const nav = bar.current;
		if (!mark || !nav) return;
		// The pinned line, as the stylesheet resolved it (`inset-block-start` → computed `top`, in px).
		const pinned = Number.parseFloat(getComputedStyle(nav).top);
		if (!Number.isFinite(pinned)) return;
		stuck.value = mark.getBoundingClientRect().top < pinned - 0.5;
	};

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
		void profileHeaderCondensed.value;
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
