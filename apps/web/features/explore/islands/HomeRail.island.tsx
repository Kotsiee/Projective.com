import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Icon } from "@projective/ui/icons";
import { Tooltip } from "@projective/ui/feedback";
import { useCarousel } from "@features/marketing/core/useCarousel.ts";
import { vars } from "@features/marketing/core/style.ts";
import { RailHeading } from "../components/RailHeading.tsx";
import { filterHref } from "../core/routing.ts";
import type { ExploreEntity } from "../types/explore-types.ts";
import "../styles/explore.css";
import "../styles/explore-home.css";

/**
 * HomeRail — the ONE horizontal section module every Explore Home section is built from.
 *
 * Anatomy, left to right across the header: the two-tone title (a bold-italic category and a regular
 * muted qualifier), an optional inline search, the scroll-progress separator, and the paging arrows.
 * Beneath it, a native overflow track holding the cards.
 *
 * ## Why the cards are `children` and not a prop
 *
 * The cards stay SERVER components. They are passed in as children, rendered on the server, and this
 * island only wraps them — so the first byte carries the real content and this island's job is
 * limited to the interaction. Nothing about a card's markup crosses the hydration boundary as data.
 *
 * ## Why a native scroller rather than the shared `Carousel`
 *
 * `@projective/ui/display`'s `Carousel` is a paged TRANSFORM slider: the track is translated inside an
 * `overflow: clip` viewport, so it has no `scrollLeft` to read and a continuous progress fill on top
 * of it would be a fiction — the best it could honestly report is `page / pages`. It also commits a
 * drag on a threshold rather than panning 1:1, keys its responsive columns to the VIEWPORT (wrong on a
 * laned surface, a trap `RelatedCarousel` already had to work around), renders its arrows internally
 * with no external handle, and duplicates edge slides in circular mode — which would duplicate the
 * `CardActions` island every explore card mounts.
 *
 * The marketing rails' `useCarousel` + `attachDragScroll` pair is the native-scroll idiom this needed:
 * drag-to-pan with a release fling, real `scrollLeft`, and — because the fling WRITES `scrollLeft`
 * rather than transforming — a progress signal that stays in step through the whole gesture with no
 * second animation loop. The cost is that the product now carries two horizontal idioms; that is a
 * conscious call, recorded here rather than discovered later.
 */
export interface HomeRailProps {
	/** Stable id — used for the heading's `aria-labelledby` and the section anchor. */
	id: string;
	/** The bold-italic half of the heading — the category. */
	lead: string;
	/** The regular muted half — what the reader gets from it. */
	tail: string;
	/** Where the whole heading links, i.e. "see all of this category". */
	href?: string;
	/**
	 * Render an inline search field in the header. It filters the rail's own cells as the reader
	 * types and submits to the full results page — so a search that finds nothing here still has
	 * somewhere to go.
	 */
	search?: boolean;
	searchPlaceholder?: string;
	/**
	 * The category a submitted search navigates into.
	 *
	 * A CATEGORY token rather than an href builder, deliberately: an island's props are serialized
	 * into the page for hydration, and a function cannot be serialized — passing one fails the whole
	 * render with "Serializing functions is not supported". So the caller names the destination and
	 * the island builds the URL with the same `filterHref` every other link on this page uses.
	 */
	searchCategory?: ExploreEntity;
	/** Extra modifier on the section root (e.g. `ex-continue`). */
	modifier?: string;
	/** Accessible label for the paging controls, e.g. "Services". */
	label?: string;
	children: ComponentChildren;
}

export default function HomeRail(
	{
		id,
		lead,
		tail,
		href,
		search = false,
		searchPlaceholder = "Search…",
		searchCategory,
		modifier = "",
		label,
		children,
	}: HomeRailProps,
): JSX.Element {
	const { trackRef, prev, next, atStart, atEnd, progress } = useCarousel();
	const query = useSignal("");
	// `true` until measured. A rail that has not been measured yet must not paint a disabled Next —
	// on a track that does overflow, that is a control the reader would find dead on arrival.
	const scrollable = useSignal(true);
	const rootRef = useRef<HTMLElement>(null);
	const navLabel = label ?? lead;

	// #region Overflow probe
	// The progress track is withheld when there is nothing to scroll, so the rail has to know. It is
	// the same measurement `useCarousel` already makes for `atEnd`, but that hook exposes only the
	// boolean edges — and `atStart && atEnd` is ALSO true for one frame before the first sync on a
	// track that does overflow, so it cannot be used as the probe.
	useEffect(() => {
		const el = trackRef.current;
		if (!el) return;
		const measure = () => {
			scrollable.value = el.scrollWidth - el.clientWidth > 2;
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		for (const child of Array.from(el.children)) ro.observe(child);
		return () => ro.disconnect();
	}, []);
	// #endregion

	// #region Inline search
	/**
	 * Filter the rail's own cells by their rendered text.
	 *
	 * Reading `textContent` rather than a `data-search-text` attribute is deliberate: the cells are
	 * server-rendered children this island never authored, so any attribute contract would have to be
	 * duplicated at every call site and would drift the moment a card changed which facts it prints.
	 * What the reader can SEE is exactly what they are searching.
	 */
	function applyFilter(raw: string) {
		query.value = raw;
		const el = trackRef.current;
		if (!el) return;
		const needle = raw.trim().toLowerCase();
		let shown = 0;
		for (const cell of Array.from(el.children)) {
			if (!(cell instanceof HTMLElement)) continue;
			const hit = !needle || (cell.textContent ?? "").toLowerCase().includes(needle);
			cell.hidden = !hit;
			if (hit) shown++;
		}
		// A filter that empties the rail must say so; an empty track just looks broken.
		const empty = rootRef.current?.querySelector<HTMLElement>(".ex-rail__empty");
		if (empty) empty.hidden = shown > 0;
		el.scrollLeft = 0;
	}
	// #endregion

	return (
		<section
			class={`ex-rail${modifier ? ` ${modifier}` : ""}`}
			id={`ex-${id}`}
			aria-labelledby={`ex-${id}-title`}
			data-scrollable={scrollable.value ? "true" : "false"}
			ref={rootRef}
		>
			<header class="ex-rail__head">
				<RailHeading id={id} lead={lead} tail={tail} href={href} />

				{search && (
					<form
						class="ex-rail__search"
						role="search"
						onSubmit={(e) => {
							e.preventDefault();
							const q = query.value.trim();
							if (q) globalThis.location.href = filterHref({ q, category: searchCategory });
						}}
					>
						<Icon name="search" size="sm" />
						<input
							class="ex-rail__search-input"
							type="search"
							value={query.value}
							placeholder={searchPlaceholder}
							aria-label={`Search ${lead.toLowerCase()}`}
							onInput={(e) => applyFilter((e.currentTarget as HTMLInputElement).value)}
						/>
					</form>
				)}

				<span class="ex-rail__progress" aria-hidden="true">
					<span
						class="ex-rail__progressfill"
						style={vars({ "--ex-rail-progress": progress.value })}
					/>
				</span>

				<div class="ex-rail__nav">
					<Tooltip content="Previous">
						<button
							type="button"
							class="ex-railbtn"
							aria-label={`Scroll ${navLabel} backwards`}
							disabled={atStart.value}
							onClick={prev}
						>
							<Icon name="chevron-left" size="sm" />
						</button>
					</Tooltip>
					<Tooltip content="Next">
						<button
							type="button"
							class="ex-railbtn"
							aria-label={`Scroll ${navLabel} forwards`}
							disabled={atEnd.value}
							onClick={next}
						>
							<Icon name="chevron-right" size="sm" />
						</button>
					</Tooltip>
				</div>
			</header>

			<div class="ex-rail__track" role="list" ref={trackRef}>{children}</div>

			{search && <p class="ex-rail__empty" hidden>Nothing here matches that.</p>}
		</section>
	);
}
