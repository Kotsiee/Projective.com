import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import { RailFrame } from "./RailFrame.tsx";
import { RailCell } from "./RailCell.tsx";
import { HomeGrid } from "./HomeGrid.tsx";
import { EntityCard } from "./cards/EntityCard.tsx";
import { resultHeading } from "../core/home-model.ts";
import type { HrefContext } from "../core/routing.ts";
import type { ExploreItem, ResultGroup } from "../types/explore-types.ts";

/** Cap on how many cards a merged section reveals before "Show all" takes over. Even, so the grid
 * variant never ends on a ragged half row. */
const RAIL_CAP = 12;

/**
 * ResultsGroupRow — one merged section in the cross-category ("all") Search Results feed, reached
 * when a query or a filter is active and no single category is selected.
 *
 * It is the HOME's section module, not a second one. A reader who learned the rail on the discovery
 * Home — two-tone heading, drag-to-pan track, progress separator, paging arrows — meets the same
 * object here, and the projects section takes the same 2×2 {@link HomeGrid} Home gives it, because a
 * brief is compared against its neighbours rather than browsed past. The presentation this replaces
 * was a bare scroll-snap row with no drag and no arrows, plus a single-column project stack whose
 * only rule targeted `.ex-projrow` — a class nothing has rendered since the project row became a
 * bordered card, so those cards were butting against each other with no gap at all.
 *
 * What does NOT come from Home is the gutter. Home's `.ex-home__section` wrapper pads by
 * `--ex-pad-x`; this pane has already spent its own (`--ex-dash-pad-x`, on `.ex-dash`), so the column
 * stays `.ex-dash__groups` and the rail's trailing bleed is restated against that variable in
 * `explore-results.css`.
 *
 * The section id keeps its `ex-group-{key}` shape — `ex-group-services` and friends survive as
 * anchors — rather than adopting the Home's bare `ex-{key}`, which would also collide with a Home
 * section name for no gain.
 *
 * Presentational; selection comes from the parent island. Because that parent IS an island, this
 * renders {@link RailFrame} directly rather than the `HomeRail` island wrapper: nesting a second
 * hydration root would push these children, which carry `onSelect`, through props serialization.
 */
export function ResultsGroupRow(
	{ group, showAllHref, onSelect, ctx, authed = false }: {
		group: ResultGroup;
		showAllHref: string;
		onSelect?: (item: ExploreItem) => void;
		ctx: HrefContext;
		authed?: boolean;
	},
): JSX.Element {
	const { lead, tail } = resultHeading(group);
	const shown = group.items.slice(0, RAIL_CAP);
	const id = `group-${group.key}`;

	// The heading links here too (the Home contract). This keeps the destination visible as well:
	// on a results page "show me only this category" is a primary act, and one carried solely by a
	// heading is one most readers never find. It folds away below the phone cusp.
	const showAll = (
		<a class="ex-viewall ex-rail__action" href={showAllHref}>
			<span>Show all</span>
			<Icon name="arrow-right" aria-hidden />
		</a>
	);

	if (group.variant === "list") {
		return (
			<HomeGrid id={id} lead={lead} tail={tail} href={showAllHref} action={showAll}>
				{shown.map((it) => (
					<div class="ex-rail__gridcell" role="listitem" key={it.id}>
						<EntityCard item={it} ctx={ctx} onSelect={onSelect} authed={authed} />
					</div>
				))}
			</HomeGrid>
		);
	}

	return (
		<RailFrame
			id={id}
			lead={lead}
			tail={tail}
			href={showAllHref}
			label={group.title}
			action={showAll}
		>
			{shown.map((it) => (
				<RailCell key={it.id}>
					<EntityCard
						item={it}
						ctx={ctx}
						onSelect={onSelect}
						authed={authed}
						productLayout="fixed"
					/>
				</RailCell>
			))}
		</RailFrame>
	);
}
