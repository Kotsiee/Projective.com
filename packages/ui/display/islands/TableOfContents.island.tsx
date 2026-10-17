import "../styles/editorial.css";
import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import type { TocEntry } from "@projective/types/content";
import { Drawer } from "../../feedback/islands/Drawer.tsx";
import { TocList, TocNav } from "../components/TocNav.tsx";
import { EDITORIAL_ICONS } from "../core/editorial-icons.tsx";
import { motionReduced, pickActiveHeading, readingLineFor, tocIds } from "../core/scroll-spy.ts";

// #region Props
/** Props for {@link TableOfContents}. */
export interface TableOfContentsProps {
	/** The tree to list — `docToc(anchorDoc(doc))`, so its ids are the rendered headings' ids. */
	entries: TocEntry[];
	/** The navigation's name and visible label (default "On this page"). */
	label?: string;
	/** The nav's id (default `doc-toc`). */
	id?: string;
}
// #endregion

/** How long the sheet takes to leave (the Drawer's exit, `--dur-medium`) plus one frame of margin. */
const SHEET_EXIT_MS = 300;

/** Scroll `id` to its landing position (its scroll margin), record it in the address bar, focus it. */
function jumpTo(id: string): void {
	const heading = document.getElementById(id);
	if (!heading) return;
	heading.scrollIntoView({ behavior: motionReduced() ? "auto" : "smooth", block: "start" });
	try {
		history.pushState(history.state, "", `#${id}`);
	} catch { /* a sandboxed frame can refuse history writes — the scroll still happened */ }
	// After the sheet has gone and handed focus back to its trigger, move it on to the section, so the
	// next Tab continues from where the reader now is — not from the top of the document.
	setTimeout(() => {
		const link = heading.querySelector<HTMLElement>("a[href]") ?? heading;
		link.focus({ preventScroll: true });
	}, SHEET_EXIT_MS);
}

/**
 * TableOfContents — the interactive "On this page" (island). Renders {@link TocNav} and adds:
 *
 * - **Scroll-spy.** An `IntersectionObserver` on every listed heading fires as headings cross the
 *   reading line (just below their scroll margin) or the viewport's edges; each callback re-reads the
 *   heading positions and marks the last one reached `aria-current="location"`. Re-reading on every
 *   callback is what keeps a long jump (a hash link, the sheet) correct — headings it skipped over
 *   never fire an intersection of their own.
 * - **The bottom sheet** below `--bp-md`: the trigger opens a bottom `Drawer` (the overlay family,
 *   Decision #171 — portalled, focus-trapped, Escape and scrim dismissal, focus returned) listing the
 *   same tree; choosing a section closes the sheet, scrolls to it, writes its hash and moves focus to
 *   its heading.
 *
 * The rail and the disclosure stay plain in-page anchors, so they work before hydration and without
 * JavaScript. State is three signals local to the island; it reads nothing but the DOM it is in.
 */
export default function TableOfContents(
	{ entries, label = "On this page", id = "doc-toc" }: TableOfContentsProps,
): JSX.Element {
	const active = useSignal<string | null>(null);
	const enhanced = useSignal(false);
	const sheetOpen = useSignal(false);

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
			if (next !== active.value) active.value = next;
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
	}, [entries]);

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
					sheetOpen.value = true;
				}}
				glyphs={EDITORIAL_ICONS}
			/>
			<Drawer visible={sheetOpen} position="bottom" header={label} class="ui-toc-sheet">
				<TocList
					entries={entries}
					activeId={active.value}
					variant="sheet"
					id={`${id}-sheet`}
					onNavigate={(target, event) => {
						event.preventDefault();
						sheetOpen.value = false;
						jumpTo(target);
					}}
				/>
			</Drawer>
		</>
	);
}
