import type { JSX } from "preact";
import { CardLink } from "../CardLink.tsx";
import { OwnerBadge } from "../OwnerBadge.tsx";
import CardActions from "../../islands/CardActions.island.tsx";
import { postedLabel } from "../../core/card-signals.ts";
import { itemHref } from "../../core/routing.ts";
import type { HrefContext } from "../../core/routing.ts";
import type { ExploreItem, ProjectItem } from "../../types/explore-types.ts";

/**
 * ProjectCard — an open project accepting applications. Replaces the former `ProjectRow`.
 *
 * A project is the one member of the family with no media of its own, and it is the one that is
 * deliberately EXEMPT from the ambient system: with no image there is no colour to extract, and
 * borrowing the publisher's avatar hue would tint a brief with a colour that says nothing about it. So
 * the project card separates the way the other cards no longer need to — a real hairline border around
 * a stable surface — and never takes the hover wash. It carries no trust chips and no sponsorship
 * badge either; those belong to things being sold, and a brief is being staffed.
 *
 * Anatomy: a header row splitting the publisher from the posting age; the title; the stage pipeline as
 * a single breadcrumb pill; a three-line description; then the required skills.
 *
 * It stopped being a full-width divider row because a row is a list and a list implies a ranking that
 * an open call does not have. Two columns of equal cards say these are alternatives, which is what
 * they are.
 */
export function ProjectCard(
	{ item, ctx = { scope: "explore" }, onSelect, authed = false }: {
		item: ProjectItem;
		ctx?: HrefContext;
		onSelect?: (item: ExploreItem) => void;
		authed?: boolean;
	},
): JSX.Element {
	const posted = postedLabel(item.createdAt);

	return (
		<article class="ex-card ex-card--project" data-item-id={item.id} data-item-type={item.type}>
			<CardLink
				item={item}
				ctx={ctx}
				onSelect={onSelect}
				label={`${item.title} for ${item.org} — ${item.budget}`}
			/>
			<CardActions title={item.title} href={itemHref(item, ctx)} authed={authed} />

			<div class="ex-proj__head">
				<OwnerBadge owner={item.owner} variant="creator" />
				{posted && <span class="ex-proj__posted">{posted}</span>}
			</div>

			<h3 class="ex-proj__title">{item.title}</h3>

			{item.phases.length > 0 && (
				<div class="ex-proj__pipeline" role="list" aria-label="Project stages">
					{item.phases.map((phase, i) => (
						<span class="ex-proj__stage" role="listitem" key={phase}>
							{i > 0 && <span class="ex-proj__chevron" aria-hidden="true">›</span>}
							<span class="ex-proj__stagename">{phase}</span>
						</span>
					))}
				</div>
			)}

			<p class="ex-proj__desc">{item.summary}</p>

			{item.skills.length > 0 && (
				<ul class="ex-proj__skills" role="list">
					{item.skills.map((skill) => (
						<li class="ex-proj__skill" key={skill.label}>{skill.label}</li>
					))}
				</ul>
			)}
		</article>
	);
}
