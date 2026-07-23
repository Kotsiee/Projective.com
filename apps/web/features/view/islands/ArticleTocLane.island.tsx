import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { Tooltip } from "@projective/ui/feedback";
import "@features/profile/styles/profile.css";
import "../styles/article-view.css";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import { ViewIcon } from "../components/view-glyphs.tsx";
import { activeTocId } from "../core/view-state.ts";
import type { ArticleTocEntry } from "@projective/types/explore";

/**
 * ArticleTocLane — the Articles view's side nav: an interactive Table of Contents built from the
 * article's heading structure (parsed server-side into `toc`, so it SSR-paints). It reuses the profile
 * `pf-lane` skeleton VERBATIM (collapsed dot-rail ⇄ expanded list, density-switched by the shell), and
 * adds the interactivity: a click smooth-scrolls to the heading, and a window-scroll spy marks the
 * heading currently in view active (shared `activeTocId` signal → the highlight). The collapsed rail
 * shows one dot per heading (indented for subheadings).
 */
export interface ArticleTocLaneProps {
	toc: ArticleTocEntry[];
	/** Read-time label shown in the lane header. */
	readLabel: string;
}

function setLaneCollapsed(next: boolean): void {
	try {
		globalThis.dispatchEvent(
			new CustomEvent(MIDDLE_LANE_TOGGLE_EVENT, { detail: { collapsed: next } }),
		);
	} catch { /* SSR / no window — non-fatal */ }
}

function scrollToHeading(id: string): void {
	try {
		const el = document.getElementById(id);
		if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
		activeTocId.value = id;
	} catch { /* no DOM — non-fatal */ }
}

export default function ArticleTocLane({ toc, readLabel }: ArticleTocLaneProps): JSX.Element {
	const active = activeTocId.value;

	// Scrollspy: mark the heading currently under the sticky chrome active. A plain scroll probe (not an
	// IntersectionObserver) so the offset math matches the sticky top-bar + header band exactly.
	useEffect(() => {
		if (toc.length === 0) return;
		const offset = () => {
			const cs = getComputedStyle(document.documentElement);
			const bar = Number.parseInt(cs.getPropertyValue("--shell-topbar-h"), 10) || 48;
			return bar + 96;
		};
		const onScroll = () => {
			const y = offset();
			let current = toc[0]?.id ?? null;
			for (const t of toc) {
				const el = document.getElementById(t.id);
				if (el && el.getBoundingClientRect().top <= y) current = t.id;
			}
			if (current !== activeTocId.value) activeTocId.value = current;
		};
		onScroll();
		globalThis.addEventListener("scroll", onScroll, { passive: true });
		globalThis.addEventListener("resize", onScroll);
		return () => {
			globalThis.removeEventListener("scroll", onScroll);
			globalThis.removeEventListener("resize", onScroll);
		};
	}, [toc]);

	return (
		<div class="pf-lane vw-lane art-toclane">
			{/* Collapsed dot rail. */}
			<nav class="pf-lane__rail" aria-label="Article contents">
				<div class="pf-lane__rail-group art-tocrail">
					{toc.map((t) => (
						<Tooltip key={t.id} content={t.text} placement="right">
							<button
								type="button"
								class="art-tocdot"
								data-level={t.level}
								data-active={active === t.id ? "true" : undefined}
								aria-label={t.text}
								onClick={() => scrollToHeading(t.id)}
							>
								<span class="art-tocdot__mark" />
							</button>
						</Tooltip>
					))}
				</div>
				<div class="pf-lane__rail-group pf-lane__rail-group--bottom">
					<Tooltip content="Expand contents" placement="right">
						<button
							type="button"
							class="pf-railbtn pf-railbtn--toggle"
							data-collapsed="true"
							aria-label="Expand contents"
							aria-pressed={true}
							onClick={() => setLaneCollapsed(false)}
						>
							<SidebarToggleIcon />
						</button>
					</Tooltip>
				</div>
			</nav>

			{/* Expanded contents list. */}
			<div class="pf-lane__full">
				<div class="pf-lane__header vw-lane__header art-toclane__header">
					<span class="art-toclane__title">
						<ViewIcon name="list" size={18} />
						<span>Contents</span>
					</span>
					<span class="art-toclane__read">{readLabel}</span>
				</div>

				<nav class="pf-lane__scroll art-toclane__scroll" aria-label="Table of contents">
					<ol class="art-toc" role="list">
						{toc.map((t) => (
							<li
								key={t.id}
								class="art-toc__item"
								data-level={t.level}
								data-active={active === t.id ? "true" : undefined}
							>
								<a
									class="art-toc__link"
									href={`#${t.id}`}
									aria-current={active === t.id ? "location" : undefined}
									onClick={(e) => {
										e.preventDefault();
										scrollToHeading(t.id);
									}}
								>
									{t.text}
								</a>
							</li>
						))}
					</ol>
				</nav>

				<div class="pf-lane__footer">
					<Tooltip content="Collapse contents" placement="top">
						<button
							type="button"
							class="pf-lane__collapse"
							aria-label="Collapse contents"
							aria-pressed={false}
							onClick={() => setLaneCollapsed(true)}
						>
							<SidebarToggleIcon />
						</button>
					</Tooltip>
				</div>
			</div>
		</div>
	);
}
