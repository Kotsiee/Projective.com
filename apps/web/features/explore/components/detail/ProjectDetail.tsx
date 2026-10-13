import type { JSX } from "preact";
import { OwnerBadge } from "../OwnerBadge.tsx";
import {
	DetailHead,
	DetailMedia,
	DetailPrice,
	DetailSection,
	DetailSkills,
	DetailSummary,
	Fact,
	FactGrid,
	InlineList,
	RatingFact,
} from "./DetailParts.tsx";
import { subjectRating } from "../../core/card-signals.ts";
import { projectBudgetAmount } from "../../core/pricing.ts";
import type { ProjectItem } from "../../types/explore-types.ts";

/**
 * ProjectDetail — a brief at a glance, in the project page's order: the client's banner, title and
 * poster, then budget · stage · Pipeline/One-Off · the poster's client rating, the summary, the phase
 * plan and the roles it is hiring for.
 */
export function ProjectDetail(
	{ item, titleId }: { item: ProjectItem; titleId: string },
): JSX.Element {
	const budget = projectBudgetAmount(item);

	return (
		<>
			{item.cover && <DetailMedia src={item.cover} banner />}
			<DetailHead eyebrow={["Project"]} title={item.title} titleId={titleId}>
				<OwnerBadge owner={item.owner} size="md" />
			</DetailHead>
			<FactGrid>
				{(budget || item.budget) && (
					<Fact label="Escrow budget">
						<DetailPrice amount={budget} fallback={item.budget} />
					</Fact>
				)}
				{item.stage && <Fact label="Stage">{item.stage}</Fact>}
				<Fact label="Type">{item.classification === "pipeline" ? "Pipeline" : "One-Off"}</Fact>
				{item.org && item.org !== item.owner.name && <Fact label="Client">{item.org}</Fact>}
				<RatingFact label="Client rating" rating={subjectRating(item)} />
			</FactGrid>
			<DetailSummary text={item.summary} />
			{item.phases.length > 0 && (
				<DetailSection title="Phase plan">
					<ol class="ex-detail__phases">
						{item.phases.map((phase, i) => (
							<li class="ex-detail__phase" key={`${i}:${phase}`}>
								<span class="ex-detail__phaseidx" aria-hidden="true">{i + 1}</span>
								<span>{phase}</span>
							</li>
						))}
					</ol>
				</DetailSection>
			)}
			{item.roles.length > 0 && (
				<DetailSection title="Hiring for">
					<InlineList items={item.roles} />
				</DetailSection>
			)}
			<DetailSkills skills={item.skills} />
		</>
	);
}
