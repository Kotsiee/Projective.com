import type { JSX } from "preact";
import { EntityCard } from "./cards/EntityCard.tsx";
import type { HrefContext } from "../core/routing.ts";
import type { ResultGroup } from "../types/explore-types.ts";
import type { ExploreItem } from "../types/explore-types.ts";

/** Cap on how many cards a merged rail reveals before "Show all" takes over. */
const RAIL_CAP = 12;

/**
 * ResultsGroupRow — one merged section in the cross-category ("all") Search Results feed. Card
 * sections render as an elegant horizontal rail (native scroll-snap, no enclosing boxes); the
 * projects section renders as a text-forward divider-line list. The heading carries no count number
 * and no numeric prefix (clean micro-copy); "Show all →" is a real anchor into the isolated feed for
 * the section's primary category. Presentational — selection comes from the parent island.
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
	const titleId = `ex-group-${group.key}`;
	const shown = group.items.slice(0, RAIL_CAP);
	const isList = group.variant === "list";
	return (
		<section class="ex-group" aria-labelledby={titleId}>
			<div class="ex-group__head">
				<h2 class="ex-group__title" id={titleId}>{group.title}</h2>
				<a class="ex-viewall" href={showAllHref}>Show all →</a>
			</div>
			{isList
				? (
					<div class={`ex-group__list ex-group__list--${group.key}`} role="list">
						{shown.map((it) => (
							<div role="listitem" key={it.id}>
								<EntityCard item={it} ctx={ctx} onSelect={onSelect} authed={authed} />
							</div>
						))}
					</div>
				)
				: (
					<div class={`ex-group__rail ex-group__rail--${group.key}`} role="list">
						{shown.map((it) => (
							<div class="ex-group__rail-cell" role="listitem" key={it.id}>
								<EntityCard item={it} ctx={ctx} onSelect={onSelect} authed={authed} />
							</div>
						))}
					</div>
				)}
		</section>
	);
}
