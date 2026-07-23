import type { JSX } from "preact";
import "../styles/project-view.css";
import StageFlow from "../islands/StageFlow.island.tsx";
import { ViewIcon } from "./view-glyphs.tsx";
import type { ExploreItem, ProjectViewExtra } from "@projective/types/explore";

/**
 * ProjectShowcaseBody — the SHARED main body of the projects showcase template (About + tailored
 * project details + required roles + the interactive {@link StageFlow}). It is the single presentation
 * both `/view/[id]?type=projects` (via {@link ProjectViewScreen}) and the authenticated
 * `/projects/[projectId]` Preview reuse, so a change to the showcase layout propagates to both surfaces
 * automatically (the task's "shared feature module" requirement).
 *
 * `emptyState` tunes how unpopulated fields degrade — the key difference between a fully-composed
 * discovery listing and an in-setup project (root brief §"Handling Incomplete Data"):
 *  - `none`   — the discovery default: empty sections are simply omitted (the `/view/[id]` corpus is
 *    always fully populated, so this path is byte-identical to the original screen).
 *  - `neutral` — a non-owner viewing a sparse project: a calm "not specified yet" placeholder.
 *  - `prompt` — the owner/client viewing their own project: an actionable "add …" prompt that doubles
 *    as an invitation to open the Edit tab.
 * The stage flow, chips, and metagrid are all reused verbatim; only the empty-field affordances differ.
 */
export interface ProjectShowcaseBodyProps {
	/** The project item (title · summary · roles). Both surfaces supply an `ExploreItem` of type projects. */
	item: ExploreItem;
	project: ProjectViewExtra;
	/** How unpopulated fields render (see the component doc). Defaults to the discovery `none`. */
	emptyState?: "none" | "neutral" | "prompt";
}

/** One project-details cell — `empty` marks a placeholder value so it can be tinted down. */
interface DetailCell {
	label: string;
	value: string;
	empty?: boolean;
}

export function ProjectShowcaseBody(
	{ item, project, emptyState = "none" }: ProjectShowcaseBodyProps,
): JSX.Element {
	const { finance } = project;
	const roles = item.type === "projects" ? item.roles : [];
	const isPipeline = project.classification === "pipeline";
	const prompt = emptyState === "prompt";
	const showEmpty = emptyState !== "none";

	const hasSummary = item.summary.trim().length > 0;
	const hasTicketPrice = finance.ticketPrice.label.trim().length > 0;
	const hasSeats = finance.totalSeats > 0;

	// Classification-tailored project detail cells (§Part 3 — no generic Client/Stage/Engagement).
	const details: DetailCell[] = [
		{ label: "Project type", value: project.classificationLabel },
	];
	if (isPipeline && (project.stage || showEmpty)) {
		details.push({
			label: "Current stage",
			value: project.stage || (prompt ? "Set the active stage" : "Not started"),
			empty: !project.stage,
		});
	}
	if (isPipeline) details.push({ label: "Stages", value: `${project.stages.length}` });
	details.push({
		label: "Ticket price",
		value: hasTicketPrice ? finance.ticketPrice.label : (prompt ? "Set ticket pricing" : "Not set"),
		empty: !hasTicketPrice,
	});
	details.push({
		label: "Open seats",
		value: hasSeats
			? `${finance.openSeats} of ${finance.totalSeats}`
			: (prompt ? "Add seats" : "Not set"),
		empty: !hasSeats,
	});

	return (
		<div class="vw-project__body">
			<div class="vw-project__main">
				<section class="vw-section">
					<h2 class="vw-section__label">About this project</h2>
					{hasSummary
						? <p class="vw-project__summary">{item.summary}</p>
						: (
							<p class="vw-project__summary vw-empty">
								{prompt
									? "Add a description so freelancers understand the goals and context."
									: "No description has been added yet."}
							</p>
						)}
				</section>

				<section class="vw-section">
					<h2 class="vw-section__label">Project details</h2>
					<dl class="vw-metagrid">
						{details.map((d) => (
							<div key={d.label} class="vw-metagrid__cell">
								<dt>{d.label}</dt>
								<dd class={d.empty ? "vw-empty" : undefined}>{d.value}</dd>
							</div>
						))}
					</dl>
				</section>

				{roles.length > 0
					? (
						<section class="vw-section">
							<h2 class="vw-section__label">Who this project needs</h2>
							<ul class="vw-chips" role="list">
								{roles.map((r, i) => (
									<li key={`${r}-${i}`} class="vw-chip vw-chip--role">
										<ViewIcon name="roles" size={13} />
										<span>{r}</span>
									</li>
								))}
							</ul>
						</section>
					)
					: showEmpty
					? (
						<section class="vw-section">
							<h2 class="vw-section__label">Who this project needs</h2>
							<p class="vw-empty">
								{prompt
									? "No roles yet — add the roles you're hiring for so applicants know how to help."
									: "Roles haven't been specified for this project."}
							</p>
						</section>
					)
					: null}
			</div>

			{/* Stage flow visualizer. */}
			<section class="vw-project__stages">
				<div class="vw-project__stageshead">
					<h2 class="vw-h2">{isPipeline ? "Stage flow" : "Project delivery"}</h2>
					<p class="vw-project__stageshint">
						{isPipeline
							? "Expand a stage for its scope, open seats or roles, ticket pricing, and required skills."
							: "A single delivery engagement — expand it for the open seats or roles, ticket pricing, and required skills."}
					</p>
				</div>
				{project.stages.length > 0
					? <StageFlow stages={project.stages} title={item.title} emptyState={emptyState} />
					: (
						<p class="vw-empty vw-empty--block">
							{prompt
								? "No stages outlined yet — open the Edit tab to shape the workflow."
								: "The stage workflow hasn't been outlined yet."}
						</p>
					)}
			</section>
		</div>
	);
}
