import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import {
	WORKSPACE_SUBMISSION_STATE_LABEL,
	type WorkspaceClaimable,
	type WorkspaceSubmission,
} from "../../types/projects-types.ts";
import { projectHref } from "../../core/project-access.ts";
import { Block, Empty, MetaFacts } from "../dashboard/DashboardBlocks.tsx";

/**
 * A freelancer's two work signals on the Overview: where their deliverables stand in review, and
 * which ready tickets they could claim now. Server components over the composed workspace. A review
 * state is a tinted mark plus its word, never a pill (§B.11) — the hero spends the surface's one fill.
 */

const STATE_TONE: Record<WorkspaceSubmission["state"], string> = {
	pending_review: "review",
	in_revision: "warning",
	approved: "success",
};

// #region Active submissions
/** The viewer's own deliverables: returned work first, then awaiting review, then approved. */
export function SubmissionsBlock(
	{ submissions, slug }: { submissions: readonly WorkspaceSubmission[]; slug: string },
): JSX.Element {
	return (
		<Block title="Active submissions" moreHref={projectHref(slug, "submissions")}>
			{submissions.length === 0
				? <Empty>Nothing submitted yet. Work you send for review will show its state here.</Empty>
				: (
					<ul class="pjd-list">
						{submissions.map((s) => (
							<li key={s.id}>
								<a class="pjd-row" href={s.href}>
									<span class="pjd-row__icon" aria-hidden="true">
										<Icon name="submission" size="sm" />
									</span>
									<span class="pjd-row__body">
										<span class="pjd-row__title">{s.title}</span>
										{s.stageName && <MetaFacts items={[s.stageName]} />}
									</span>
									<span class="pjd-row__end">
										<span class="pjd-tstate" data-tone={STATE_TONE[s.state]}>
											<span class="pjd-tstate__mark" aria-hidden="true" />
											{WORKSPACE_SUBMISSION_STATE_LABEL[s.state]}
										</span>
									</span>
								</a>
							</li>
						))}
					</ul>
				)}
		</Block>
	);
}
// #endregion

// #region Claimable tasks
/** Ready tickets open for a claim on the viewer's stages, each within their workload cap. */
export function ClaimableBlock(
	{ claimable }: { claimable: readonly WorkspaceClaimable[] },
): JSX.Element {
	return (
		<Block title="Claimable tasks">
			{claimable.length === 0
				? <Empty>No tickets are open for you to claim right now.</Empty>
				: (
					<ul class="pjd-list">
						{claimable.map((c) => (
							<li key={c.ticketId}>
								<a class="pjd-row" href={c.href}>
									<span class="pjd-row__icon" aria-hidden="true">
										<Icon name="ticket" size="sm" />
									</span>
									<span class="pjd-row__body">
										<span class="pjd-row__title">{c.title}</span>
										<MetaFacts
											items={[c.stageName, c.loadLabel, c.dueLabel].filter(
												(fact): fact is string => !!fact,
											)}
										/>
									</span>
								</a>
							</li>
						))}
					</ul>
				)}
		</Block>
	);
}
// #endregion
