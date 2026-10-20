import type { ComponentChildren, JSX } from "preact";
import type { OverviewRegion as RegionPlace } from "../../core/overview-deck.ts";

/** A region head's one navigation: an anchor in the tier-5 text weight. */
export interface RegionLink {
	label: string;
	href: string;
}

/** Props for {@link OverviewRegion}. */
export interface OverviewRegionProps {
	place: RegionPlace;
	titleId: string;
	title: string;
	/** A fact beside the title in the meta register ("Last 30 days"). */
	meta?: string;
	link?: RegionLink | null;
	children: ComponentChildren;
}

/**
 * One region of the Overview's grid: a section header in the label register over its content, never a
 * box. Its column span, row and side come from `overviewRegions`, as data attributes the stylesheet
 * reads, so no region writes an inline style.
 */
export function OverviewRegion(props: OverviewRegionProps): JSX.Element {
	const { place } = props;
	return (
		<section
			class="wsp-ovgrid__region"
			data-region={place.key}
			data-span={place.span}
			data-row={place.row}
			data-col={place.col}
			aria-labelledby={props.titleId}
		>
			<header class="wsp-ovgrid__head">
				<h2 class="wsp-band__title" id={props.titleId}>{props.title}</h2>
				{props.meta && <span class="wsp-ovgrid__meta">{props.meta}</span>}
				{props.link && (
					<a
						class="ui-button ui-button--primary ui-button--text ui-button--size-sm wsp-band__more wsp-ovgrid__link"
						href={props.link.href}
					>
						<span class="ui-button__label">{props.link.label}</span>
					</a>
				)}
			</header>
			{props.children}
		</section>
	);
}
