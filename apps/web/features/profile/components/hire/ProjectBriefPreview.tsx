import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { MoneyView } from "@projective/ui/display/money";
import type { HireBrief, ProjectFormat } from "@projective/types/projects";
import { MetaLine, SpecLedger, StatusMark } from "@features/view/components/entity-view-parts.tsx";

/**
 * ProjectBriefPreview — the assignment modal's read-only preview of the viewer's own project, in
 * the `/view` page's vocabulary: title + lifecycle status, one middot meta line, the summary, the
 * stage run as a ledger (name → configured rate), and the roster with each member's stages.
 *
 * Built from the {@link HireBrief} rather than from an `EntityView`, because a client's own project
 * is the OWNER's projection (`ProjectSetup` + the roster) and has no discovery-corpus view — but it
 * renders through the same parts (`entity-view-parts.tsx`) the page uses, so the registers, the
 * rhythm and the no-card rule are the page's. The one containered non-control is the lifecycle
 * STATUS (§B.11.3), which is a state and earns it.
 */
export interface ProjectBriefPreviewProps {
	brief: HireBrief;
}

/** The engagement's format as the overview names it. */
const FORMAT_LABEL: Record<ProjectFormat, string> = {
	pipeline: "Pipeline",
	one_off: "One-off",
	session: "Session",
};

const STATUS_LABEL: Record<HireBrief["status"], string> = {
	draft: "Draft",
	active: "Active",
	on_hold: "On hold",
	completed: "Completed",
	cancelled: "Cancelled",
};

const STATUS_TONE: Record<HireBrief["status"], "success" | "warning" | "neutral" | "danger"> = {
	draft: "neutral",
	active: "success",
	on_hold: "warning",
	completed: "neutral",
	cancelled: "danger",
};

const ROLE_LABEL: Record<HireBrief["members"][number]["role"], string> = {
	client: "Client",
	owner: "Owner",
	admin: "Admin",
	manager: "Manager",
	freelancer: "Freelancer",
	member: "Team member",
	guest: "Guest",
};

export function ProjectBriefPreview({ brief }: ProjectBriefPreviewProps): JSX.Element {
	const stageCount = brief.pricingModel === "task" ? 1 : brief.stages.length;
	const meta = [
		FORMAT_LABEL[brief.format],
		brief.pricingModel === "task"
			? "Single stage"
			: `${stageCount} ${stageCount === 1 ? "stage" : "stages"}`,
		brief.currency,
	];

	return (
		<div class="evp-preview pf-projpreview">
			<div class="pf-projpreview__head">
				<h3 class="evp-preview__title">{brief.title}</h3>
				<StatusMark label={STATUS_LABEL[brief.status]} tone={STATUS_TONE[brief.status]} />
			</div>
			<MetaLine items={meta} />
			{brief.summary
				? <p class="evp-preview__summary">{brief.summary}</p>
				: <p class="evp-preview__summary evp-preview__summary--empty">No description yet.</p>}

			<section class="evp-preview__section">
				<h4 class="evp-preview__heading">
					{brief.pricingModel === "task" ? "The engagement" : "Stages"}
				</h4>
				<SpecLedger
					rows={brief.pricingModel === "task"
						? [{
							label: brief.stages[0]?.name ?? "Delivery",
							value: brief.taskPriceCents !== null
								? (
									<MoneyView
										minor={brief.taskPriceCents}
										currency={brief.currency}
										size="micro"
										hideOrigin
									/>
								)
								: <span class="pf-projpreview__unpriced">Priced at publish</span>,
						}]
						: brief.stages.map((stage) => ({
							label: stage.name,
							value: stage.unitPriceCents !== null
								? (
									<MoneyView
										minor={stage.unitPriceCents}
										currency={brief.currency}
										size="micro"
										hideOrigin
									/>
								)
								: <span class="pf-projpreview__unpriced">Priced at publish</span>,
						}))}
				/>
			</section>

			<section class="evp-preview__section">
				<h4 class="evp-preview__heading">
					Team{brief.members.length > 0 ? ` · ${brief.members.length}` : ""}
				</h4>
				{brief.members.length === 0
					? <p class="evp-preview__more">Nobody has joined this project yet.</p>
					: (
						<ul class="pf-projpreview__members" role="list">
							{brief.members.map((m) => (
								<li key={m.id} class="pf-projpreview__member">
									<Avatar
										image={m.party.avatar ?? undefined}
										label={m.party.name}
										size={28}
										shape="circle"
									/>
									<span class="pf-projpreview__member-text">
										<span class="pf-projpreview__member-name">{m.party.name}</span>
										<MetaLine
											items={[
												ROLE_LABEL[m.role],
												...(m.assignedStages.length ? [m.assignedStages.join(", ")] : []),
											]}
											class="pf-projpreview__member-meta"
										/>
									</span>
								</li>
							))}
						</ul>
					)}
			</section>
		</div>
	);
}
