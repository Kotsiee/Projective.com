import type { JSX } from "preact";
import { CardLink } from "../CardLink.tsx";
import { OwnerBadge } from "../OwnerBadge.tsx";
import CardActions from "../../islands/CardActions.island.tsx";
import { itemHref } from "../../core/routing.ts";
import type { HrefContext } from "../../core/routing.ts";
import type { ExploreItem, ProjectItem } from "../../types/explore-types.ts";

/**
 * ProjectRow — a sleek, full-width divider-line row for an open project (a pipeline or one-off, created
 * by anyone). NOT a boxed card: rows separate by a single hairline. A top layer carries the creator's
 * avatar + `@handle`, a thin-font escrow budget, and a low-contrast plain-text "Promoted" note; the
 * full-width description follows; a clean horizontal pipeline chain of the explicit stages closes the
 * row. Deliberately NO progress bars, delivery percentages, or status badges — an open project is a
 * brief being staffed, not a job being tracked. Used inside a semantic list (`ProjectsList`).
 */
export function ProjectRow(
	{ item, ctx = { scope: "explore" }, onSelect, authed = false }: {
		item: ProjectItem;
		ctx?: HrefContext;
		onSelect?: (item: ExploreItem) => void;
		authed?: boolean;
	},
): JSX.Element {
	const amount = item.budget.match(/\$[\d,]+/)?.[0] ?? item.budget;
	return (
		<article class="ex-projrow">
			<CardLink
				item={item}
				ctx={ctx}
				onSelect={onSelect}
				label={`${item.title} for ${item.org} — ${item.budget}`}
			/>
			<CardActions title={item.title} href={itemHref(item, ctx)} authed={authed} />

			<div class="ex-projrow__top">
				<OwnerBadge owner={item.owner} variant="mini" />
				{item.sponsored && <span class="ex-projrow__promoted">Promoted</span>}
				<span class="ex-projrow__budget">{amount}</span>
			</div>

			<h3 class="ex-projrow__title">{item.title}</h3>
			<p class="ex-projrow__desc">{item.summary}</p>

			<div class="ex-projrow__phases" role="list" aria-label="Project stages">
				{item.phases.map((phase, i) => (
					<span class="ex-phase" role="listitem" key={phase}>
						<span class="ex-phase__name">{phase}</span>
						{i < item.phases.length - 1 && (
							<span class="ex-phase__arrow" aria-hidden="true">
								→
							</span>
						)}
					</span>
				))}
			</div>
		</article>
	);
}
