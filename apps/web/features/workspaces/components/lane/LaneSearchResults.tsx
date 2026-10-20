import type { JSX } from "preact";
import { LaneEmpty } from "@projective/ui/navigation";
import type { LaneSearchGroup } from "../../core/lane-model.ts";

/**
 * LaneSearchResults — the console search's hits in place of the lane's zones, grouped Views ·
 * Channels · Projects · People under the lane's section register. Every hit is a link; the count is
 * announced politely so a screen-reader user hears the typeahead settle.
 */
export function LaneSearchResults(
	props: { groups: readonly LaneSearchGroup[]; query: string },
): JSX.Element {
	const total = props.groups.reduce((n, g) => n + g.hits.length, 0);
	return (
		<div class="wsp-lane__results">
			<p class="ui-visually-hidden" role="status" aria-live="polite">
				{total === 0 ? "No matches" : `${total} match${total === 1 ? "" : "es"}`}
			</p>
			{total === 0
				? <LaneEmpty title="No matches" note={`Nothing here matches “${props.query.trim()}”.`} />
				: props.groups.map((group) => (
					<section key={group.id} class="wsp-lane__resultgroup" aria-label={group.label}>
						<h3 class="wsp-lane__resulthead">{group.label}</h3>
						<ul class="wsp-lane__resultlist" role="list">
							{group.hits.map((hit) => (
								<li key={hit.key}>
									<a class="wsp-lane__result" href={hit.href}>
										<span class="wsp-lane__result-label">{hit.label}</span>
										{hit.meta && <span class="wsp-lane__result-meta">{hit.meta}</span>}
									</a>
								</li>
							))}
						</ul>
					</section>
				))}
		</div>
	);
}
