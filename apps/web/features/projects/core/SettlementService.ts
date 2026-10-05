import { postProjects } from "./api.ts";
import type {
	FairExitTier,
	StageApproved,
	StageExited,
	SubmissionReviewDecision,
	SubmissionReviewed,
	SubmissionUnit,
} from "../types/projects-types.ts";
import type { ProjectsResult } from "../types/results.ts";

/**
 * SettlementService — the dumb client service for the three client decisions that move deliverables
 * and money: a submission verdict, a stage approval and a Fair Exit cancellation. It builds the
 * `/api/projects/:id/stages/:stageId/…` address and posts through {@link postProjects}, so an expired
 * token is refreshed and retried by `apiFetch`, and every failure — a 403 from the database's
 * review-authority check included — comes back as a soft `{ ok: false, message }` the island renders.
 * It never throws and never decides anything.
 */

/** The `/api/projects/:id/stages/:stageId` base, with each segment encoded. */
function stageBase(projectId: string, stageId: string): string {
	return `/api/projects/${encodeURIComponent(projectId)}/stages/${encodeURIComponent(stageId)}`;
}

/**
 * The submission id a unit carries — its LAST path segment, which is the submission's own id on both
 * the live read (`live-submissions.ts`) and the stub store (`submitStoredSubmission`).
 */
export function submissionIdOf(unit: Pick<SubmissionUnit, "path">): string | null {
	return unit.path[unit.path.length - 1] ?? null;
}

export const SettlementService = {
	/** Accept a submission, or send it back with notes. */
	reviewSubmission(
		projectId: string,
		stageId: string,
		submissionId: string,
		decision: SubmissionReviewDecision,
		notes: string,
	): Promise<ProjectsResult<SubmissionReviewed>> {
		return postProjects<SubmissionReviewed>(
			`${stageBase(projectId, stageId)}/submissions/${encodeURIComponent(submissionId)}/review`,
			{ decision, notes },
		);
	},

	/** Approve a stage and release its held escrow. */
	approveStage(projectId: string, stageId: string): Promise<ProjectsResult<StageApproved>> {
		return postProjects<StageApproved>(`${stageBase(projectId, stageId)}/approve`, {});
	},

	/** Cancel a stage under the Fair Exit split at the chosen tier. */
	cancelStageFairExit(
		projectId: string,
		stageId: string,
		tier: FairExitTier,
	): Promise<ProjectsResult<StageExited>> {
		return postProjects<StageExited>(`${stageBase(projectId, stageId)}/cancel`, { tier });
	},
};
