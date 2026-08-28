import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Icon, type IconName } from "@projective/ui/icons";
import { Tooltip } from "@projective/ui/feedback";
import { attachDragScroll, pageScroll } from "@features/marketing/core/drag-scroll.ts";
import {
	DEFAULT_RECOMMENDED_TAB,
	RECOMMENDED_TABS,
	type RecommendedTab,
} from "../core/home-model.ts";
import "../styles/explore.css";
import "../styles/explore-home.css";

/**
 * RecommendedPanel — the fold's 20/80 split: a vertical stack of category toggles on the left, the
 * selected category's single-line card rail on the right.
 *
 * ## Every panel is server-rendered; the toggle only switches which one is shown
 *
 * All four rails arrive in the first byte as children and the switch is a CSS state change on this
 * component's root. That is what makes the panel correct before hydration and instant after it — a
 * client-fetched panel would show an empty box for one round trip on the very first thing the reader
 * sees. The cost is four lists of markup on a page that displays one; at 2-8 items per list that is a
 * trade worth making, and it is the same trade the search results' grouped rails already make.
 *
 * ## "Recommended" means what the marketplace puts forward, not what it knows about you
 *
 * The ranking behind these lists is a global quality heuristic — verified entities first, then score.
 * `homeFeed()` takes no viewer argument and there is no server-side view history anywhere in this
 * product, so nothing here is personalised, and the label is deliberately a quiet muted eyebrow
 * rather than a headline that would imply otherwise.
 *
 * ## Why this does not reuse {@link HomeRail}
 *
 * A rail hook binds to one track at mount, and this panel has four tracks with independent scroll
 * positions that swap under the same pair of arrows. Nesting four `HomeRail` islands would also nest
 * hydration roots. So the paging is re-bound to whichever track is active — ~40 lines, against a
 * shared component that would have to grow a multi-track mode used by exactly one caller.
 */

/** The glyph for each toggle. Paired with a visible label, so each stays `aria-hidden` (§B.7.5). */
const TAB_ICONS: Record<RecommendedTab, IconName> = {
	services: "service",
	products: "box",
	projects: "projects",
	people: "members",
};

export default function RecommendedPanel(
	{ children }: { children: ComponentChildren },
): JSX.Element {
	const active = useSignal<RecommendedTab>(DEFAULT_RECOMMENDED_TAB);
	const atStart = useSignal(true);
	const atEnd = useSignal(false);
	const stageRef = useRef<HTMLDivElement>(null);

	/** The track belonging to the open toggle — the one the arrows and the edge state describe. */
	function activeTrack(): HTMLElement | null {
		return stageRef.current?.querySelector<HTMLElement>(
			`[data-rec-panel="${active.value}"]`,
		) ?? null;
	}

	// #region Bind paging + drag to the active track
	// Re-runs on every toggle: the previous track keeps its own scroll position (so coming back to a
	// category returns the reader where they left it), and only the live one carries the listeners.
	useEffect(() => {
		const el = activeTrack();
		if (!el) return;

		const sync = () => {
			const max = el.scrollWidth - el.clientWidth;
			atStart.value = Math.abs(el.scrollLeft) <= 2;
			atEnd.value = Math.abs(el.scrollLeft) >= max - 2;
		};

		sync();
		el.addEventListener("scroll", sync, { passive: true });
		const ro = new ResizeObserver(sync);
		ro.observe(el);
		const dispose = attachDragScroll(el);

		return () => {
			el.removeEventListener("scroll", sync);
			ro.disconnect();
			dispose();
		};
	}, [active.value]);
	// #endregion

	function page(dir: 1 | -1) {
		const el = activeTrack();
		if (el) pageScroll(el, dir);
	}

	return (
		<div class="ex-rec" data-active={active.value}>
			<div class="ex-rec__head">
				<p class="ex-rec__label" id="ex-rec-label">Recommended</p>
				<div class="ex-rec__nav">
					<Tooltip content="Previous">
						<button
							type="button"
							class="ex-railbtn"
							aria-label="Scroll recommendations backwards"
							disabled={atStart.value}
							onClick={() => page(-1)}
						>
							<Icon name="chevron-left" size="sm" />
						</button>
					</Tooltip>
					<Tooltip content="Next">
						<button
							type="button"
							class="ex-railbtn"
							aria-label="Scroll recommendations forwards"
							disabled={atEnd.value}
							onClick={() => page(1)}
						>
							<Icon name="chevron-right" size="sm" />
						</button>
					</Tooltip>
				</div>
			</div>

			{
				/*
				 * The toggles are real anchors into the full results page for their category, so with no
				 * script they navigate rather than doing nothing. Hydrated, a plain left-click switches the
				 * panel in place instead — and `isModifiedClick`'s convention is honoured implicitly by
				 * checking the modifiers, so ⌘-click and middle-click still open the category in a new tab.
				 */
			}
			<ul class="ex-rec__tabs" aria-labelledby="ex-rec-label">
				{RECOMMENDED_TABS.map((tab) => (
					<li key={tab.id}>
						<a
							class="ex-rec__tab"
							href={tab.href}
							aria-current={active.value === tab.id ? "true" : undefined}
							onClick={(e) => {
								if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) {
									return;
								}
								e.preventDefault();
								active.value = tab.id;
							}}
						>
							<Icon name={TAB_ICONS[tab.id]} size="sm" class="ex-rec__tab-icon" />
							<span class="ex-rec__tab-label">{tab.label}</span>
						</a>
					</li>
				))}
			</ul>

			<div class="ex-rec__stage" ref={stageRef}>{children}</div>
		</div>
	);
}
