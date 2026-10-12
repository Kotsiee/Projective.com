import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Icon } from "@projective/ui/icons";
import { Tooltip } from "@projective/ui/feedback";
import { useCarousel } from "@features/marketing/core/useCarousel.ts";
import { CATEGORY_CHIPS } from "../core/home-model.ts";
import { motionReduced, withViewTransition } from "../core/view-transition.ts";
import "../styles/explore.css";
import "../styles/explore-home.css";

/** The Home body the chips filter (`ExploreHome`). */
const SHELVES_ID = "ex-home-shelves";

/**
 * CategoryChips — the sticky category bar over the Home shelves.
 *
 * Every chip is a real anchor into a real `/explore` query, so the bar works with no script at all.
 * Once hydrated, a chip that names a Home shelf filters the shelves in place instead (a View
 * Transition where supported and motion is allowed) and "All" restores them; the rest still navigate.
 * The bar is `position: sticky` in CSS; this island only reports when it is stuck (`data-stuck` on its
 * wrapper), which is what draws the hairline.
 *
 * The fade and the arrow disappear together, per side, and the arrow is `visibility: hidden` at a
 * boundary rather than removed, so the row never reflows under the cursor.
 */
export default function CategoryChips(): JSX.Element {
	const { trackRef, prev, next, atStart, atEnd } = useCarousel();
	const active = useSignal<string | null>(null);
	const navRef = useRef<HTMLElement>(null);

	// #region Stuck probe
	useEffect(() => {
		const bar = navRef.current?.parentElement;
		if (!bar || typeof IntersectionObserver === "undefined") return;
		const top = parseFloat(getComputedStyle(bar).insetBlockStart) || 0;
		const io = new IntersectionObserver(
			([entry]) => {
				bar.dataset.stuck = String(
					entry.intersectionRatio < 1 && entry.boundingClientRect.top <= top + 1,
				);
			},
			{ rootMargin: `${-(top + 1)}px 0px 0px 0px`, threshold: [1] },
		);
		io.observe(bar);
		return () => io.disconnect();
	}, []);
	// #endregion

	// #region In-place filter
	function filterTo(shelf: string | null) {
		const shelves = document.getElementById(SHELVES_ID);
		if (!shelves) return false;
		withViewTransition(() => {
			active.value = shelf;
			if (shelf) shelves.dataset.filter = shelf;
			else delete shelves.dataset.filter;
			for (const el of navRef.current?.querySelectorAll<HTMLElement>("[data-chip]") ?? []) {
				const on = (el.dataset.shelf ?? null) === shelf &&
					(shelf !== null || el.dataset.chip === "all");
				if (on) el.setAttribute("aria-current", "true");
				else el.removeAttribute("aria-current");
			}
		});
		const bar = navRef.current?.parentElement;
		if (bar?.dataset.stuck === "true") {
			shelves.scrollIntoView({ block: "start", behavior: motionReduced() ? "auto" : "smooth" });
		}
		return true;
	}

	function onChipClick(e: MouseEvent, shelf: string | null) {
		if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
			return;
		}
		if (filterTo(shelf)) e.preventDefault();
	}
	// #endregion

	return (
		<nav class="ex-chips" aria-label="Browse by category" ref={navRef}>
			<Tooltip content="Previous">
				<button
					type="button"
					class="ex-railbtn"
					aria-label="Scroll categories backwards"
					disabled={atStart.value}
					onClick={prev}
				>
					<Icon name="chevron-left" size="sm" />
				</button>
			</Tooltip>

			<div
				class="ex-chips__scroller"
				ref={trackRef}
				data-at-start={atStart.value ? "true" : "false"}
				data-at-end={atEnd.value ? "true" : "false"}
			>
				<a
					class="ex-chip"
					href="/explore"
					data-chip="all"
					aria-current={active.value === null ? "true" : undefined}
					onClick={(e) => onChipClick(e, null)}
				>
					All
				</a>
				{CATEGORY_CHIPS.map((chip) => (
					<a
						class="ex-chip"
						href={chip.href}
						data-chip={chip.id}
						data-shelf={chip.shelf}
						key={chip.id}
						aria-current={chip.shelf && active.value === chip.shelf ? "true" : undefined}
						onClick={chip.shelf ? (e) => onChipClick(e, chip.shelf ?? null) : undefined}
					>
						{chip.label}
					</a>
				))}
			</div>

			<Tooltip content="Next">
				<button
					type="button"
					class="ex-railbtn"
					aria-label="Scroll categories forwards"
					disabled={atEnd.value}
					onClick={next}
				>
					<Icon name="chevron-right" size="sm" />
				</button>
			</Tooltip>
		</nav>
	);
}
