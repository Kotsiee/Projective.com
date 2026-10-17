import "../styles/editorial.css";
import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import type { TocEntry } from "@projective/types/content";
import { Drawer } from "../../feedback/islands/Drawer.tsx";
import { TocList, TocNav } from "../components/TocNav.tsx";
import { EDITORIAL_ICONS } from "../core/editorial-icons.tsx";
import {
	motionReduced,
	pickActiveHeading,
	railScrollDelta,
	readingLineFor,
	tocIds,
} from "../core/scroll-spy.ts";

// #region Props
/** Props for {@link TableOfContents}. */
export interface TableOfContentsProps {
	/**
	 * The tree to list — `docToc(anchorDoc(doc))`, so its ids are the rendered headings' ids. It may
	 * also hold cross-page entries (`TocEntry.href`, e.g. every legal document with the current one's
	 * sections as its children); those link away and are never scroll-spied.
	 */
	entries: TocEntry[];
	/** The navigation's name and visible label (default "On this page"). */
	label?: string;
	/** The nav's id (default `doc-toc`). */
	id?: string;
}
// #endregion

/** Breathing room kept between the current entry and the rail's edges when it is scrolled into view. */
const RAIL_REVEAL_MARGIN = 24;

/** Scroll `id` to its landing position (its scroll margin) and record it in the address bar. */
function jumpTo(id: string): HTMLElement | null {
	const heading = document.getElementById(id);
	if (!heading) return null;
	heading.scrollIntoView({ behavior: motionReduced() ? "auto" : "smooth", block: "start" });
	try {
		history.pushState(history.state, "", `#${id}`);
	} catch { /* a sandboxed frame can refuse history writes — the scroll still happened */ }
	return heading.querySelector<HTMLElement>("a[href]") ?? heading;
}

/**
 * Keep the rail's current entry visible inside the rail, which is its own scroll container from
 * `--bp-lg`. Moves only the rail (never the window, which a `scrollIntoView` would also scroll), and
 * only while the rail is displayed.
 */
function revealInRail(navId: string, activeId: string): void {
	const list = document.getElementById(`${navId}-list`);
	const nav = document.getElementById(navId);
	if (!list || !nav || list.offsetParent === null) return;
	if (nav.scrollHeight <= nav.clientHeight) return;
	const link = list.querySelector<HTMLElement>(`a[href="#${CSS.escape(activeId)}"]`);
	if (!link) return;
	const delta = railScrollDelta(
		nav.getBoundingClientRect(),
		link.getBoundingClientRect(),
		RAIL_REVEAL_MARGIN,
	);
	if (delta !== 0) nav.scrollBy({ top: delta, behavior: motionReduced() ? "auto" : "smooth" });
}

/**
 * TableOfContents — the interactive "On this page" (island). Renders {@link TocNav} and adds:
 *
 * - **Scroll-spy.** An `IntersectionObserver` on every listed in-page heading fires as headings cross
 *   the reading line (just below their scroll margin) or the viewport's edges; each callback re-reads
 *   the heading positions and marks the last one reached `aria-current="location"`. Re-reading on
 *   every callback is what keeps a long jump (a hash link, the sheet) correct — headings it skipped
 *   over never fire an intersection of their own. When the current entry changes, the rail (its own
 *   scroll container on a long table of contents) is scrolled just enough to keep it in view.
 * - **The bottom sheet** below `--bp-md`: the trigger opens a bottom `Drawer` (the overlay family,
 *   Decision #171 — portalled, focus-trapped, Escape and scrim dismissal) listing the same tree;
 *   choosing a section closes the sheet, scrolls to it and writes its hash, and the sheet hands focus
 *   to that heading's link instead of back to its trigger (`returnFocusRef`), so the next Tab
 *   continues from where the reader now is. Escape or the scrim return focus to the trigger.
 *
 * The rail and the disclosure stay plain anchors, so they work before hydration and without
 * JavaScript. State is three signals local to the island; it reads nothing but the DOM it is in.
 */
export default function TableOfContents(
	{ entries, label = "On this page", id = "doc-toc" }: TableOfContentsProps,
): JSX.Element {
	const active = useSignal<string | null>(null);
	const enhanced = useSignal(false);
	const sheetOpen = useSignal(false);
	const returnFocus = useRef<HTMLElement | null>(null);

	useEffect(() => {
		enhanced.value = true;
		const headings = tocIds(entries)
			.map((anchor) => document.getElementById(anchor))
			.filter((el): el is HTMLElement => el !== null);
		if (headings.length === 0 || typeof IntersectionObserver === "undefined") return;

		const margin = Number.parseFloat(getComputedStyle(headings[0]).scrollMarginBlockStart) || 0;
		const line = () => readingLineFor(margin, globalThis.innerHeight);
		const update = () => {
			const root = document.documentElement;
			const next = pickActiveHeading(
				headings.map((el) => ({ id: el.id, top: el.getBoundingClientRect().top })),
				{
					line: line(),
					viewport: globalThis.innerHeight,
					atEnd: globalThis.scrollY + globalThis.innerHeight >= root.scrollHeight - 2,
				},
			);
			if (next === active.value) return;
			active.value = next;
			if (next !== null) revealInRail(id, next);
		};

		const observer = new IntersectionObserver(update, {
			rootMargin: `${-Math.round(line())}px 0px 0px 0px`,
			threshold: [0, 1],
		});
		for (const heading of headings) observer.observe(heading);
		// `scrollend` settles the end-of-page case, where no heading crosses anything on the last scroll.
		globalThis.addEventListener("scrollend", update);
		globalThis.addEventListener("hashchange", update);
		update();
		return () => {
			observer.disconnect();
			globalThis.removeEventListener("scrollend", update);
			globalThis.removeEventListener("hashchange", update);
		};
	}, [entries, id]);

	return (
		<>
			<TocNav
				entries={entries}
				activeId={active.value}
				label={label}
				id={id}
				enhanced={enhanced.value}
				sheetOpen={sheetOpen.value}
				onOpenSheet={() => {
					returnFocus.current = null;
					sheetOpen.value = true;
				}}
				glyphs={EDITORIAL_ICONS}
			/>
			<Drawer
				visible={sheetOpen}
				position="bottom"
				header={label}
				class="ui-toc-sheet"
				returnFocusRef={returnFocus}
			>
				<TocList
					entries={entries}
					activeId={active.value}
					variant="sheet"
					id={`${id}-sheet`}
					onNavigate={(target, event) => {
						event.preventDefault();
						returnFocus.current = jumpTo(target);
						sheetOpen.value = false;
					}}
				/>
			</Drawer>
		</>
	);
}
