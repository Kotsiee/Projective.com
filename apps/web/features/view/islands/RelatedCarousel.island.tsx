import type { JSX } from "preact";
import { Carousel } from "@projective/ui/display";
import { EntityCard } from "@features/explore/components/cards/EntityCard.tsx";
import type { HrefContext } from "@features/explore/core/routing.ts";
import type { ExploreItem } from "@projective/types/explore";

/**
 * RelatedCarousel — one dedicated single-type recommendation block rendered through the reusable
 * {@link Carousel} (`@projective/ui/display`), so the "More by …" / "Similar" rails become responsive,
 * drag-swipeable, paged tracks with Previous/Next controls + pagination dots instead of a hand-rolled
 * scroll container. The library owns every interaction (pointer drag, keyboard, autoplay-off, reduced
 * motion, ARIA); this island only maps each {@link ExploreItem} to its native discovery
 * {@link EntityCard}. Products are handled separately (masonry) — this renders the card formats.
 *
 * `numScroll` tracks `numVisible` so pages are discrete (indicators = real page count, no phantom dots
 * when a short group already fits), and both cap to the item count so a lone card fills the viewport.
 * Projects are divider-rows, not fixed cards, so they get a wider slide (fewer visible) + framing CSS.
 */
export interface RelatedCarouselProps {
	items: ExploreItem[];
	ctx: HrefContext;
	authed: boolean;
	/** The single entity type in this block (drives slide sizing + the accessible name). */
	kind: ExploreItem["type"];
	label: string;
	/**
	 * Cards per row at the widest size. The library's `responsiveOptions` are keyed to the VIEWPORT, but
	 * this rail's real constraint is the column hosting it — the article template runs its rails inside a
	 * `--measure-wide` column, where the default 3-up rendered 197px cards at a 1440px window. A host
	 * that knows it is narrow says so.
	 */
	columns?: number;
}

export default function RelatedCarousel(
	{ items, ctx, authed, kind, label, columns }: RelatedCarouselProps,
): JSX.Element {
	const len = items.length;
	const isProjects = kind === "projects";
	const cap = (n: number): number => Math.max(1, Math.min(n, len));

	// Base (desktop) visible count; every value caps to the item count so a single card fills the row.
	const baseVisible = cap(columns ?? (isProjects ? 2 : 3));
	const responsiveOptions = isProjects
		? [{ breakpoint: "980px", numVisible: cap(1), numScroll: cap(1) }]
		: [
			{ breakpoint: "1080px", numVisible: cap(2), numScroll: cap(2) },
			{ breakpoint: "640px", numVisible: cap(1), numScroll: cap(1) },
		];

	return (
		<Carousel
			class="vw-carousel"
			aria-label={label}
			value={items}
			numVisible={baseVisible}
			numScroll={baseVisible}
			responsiveOptions={responsiveOptions}
			circular={len > baseVisible}
			// A group narrows to 1-visible on mobile, so it is navigable whenever it has 2+ items; a lone
			// card shows no controls. Indicators auto-hide when everything already fits (one page).
			showNavigators={len > 1}
			itemTemplate={(item) => (
				<div class={isProjects ? "vw-slide vw-slide--projects" : "vw-slide"}>
					<EntityCard item={item} ctx={ctx} authed={authed} />
				</div>
			)}
		/>
	);
}
