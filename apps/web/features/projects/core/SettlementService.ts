import { getProjects, postProjects } from "./api.ts";
import type {
	FairExitPreview,
	FairExitTier,
	PaidRevisionRaised,
	ProjectCancelled,
	ProjectCancelPreview,
	StageApproved,
	StageExited,
	SubmissionReviewDecision,
	SubmissionReviewed,
	SubmissionUnit,
} from "../types/projects-types.ts";
import type { ProjectsResult } from "../types/results.ts";
import type {
	FundingCharge,
	FundPaidRevision,
	PaidRevisionFunding,
} from "@projective/types/finance";

/** The body of a direct paid revision payment; the address supplies the rest. */
export type PaidRevisionFundingRequest = Omit<FundPaidRevision, "projectId" | "stageId" | "submissionId">;

/**
 * SettlementService — the dumb client service for the client decisions that move deliverables and
 * money: a submission verdict, a stage approval, a Fair Exit cancellation and an engagement's
 * cancellation (a brief or a bought service). It builds the `/api/projects/:id/…` address and posts through {@link postProjects},
 * so an expired token is refreshed and retried by `apiFetch`, and every failure — a 403 from the
 * database's review-authority check included — comes back as a soft `{ ok: false, message }` the
 * island renders. It never throws and never decides anything.
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

	/** Raise a paid revision round (Decision #167); the answer names what Buy Now pays for. */
	requestPaidRevision(
		projectId: string,
		stageId: string,
		submissionId: string,
		notes: string,
	): Promise<ProjectsResult<PaidRevisionRaised>> {
		const submission = encodeURIComponent(submissionId);
		return postProjects<PaidRevisionRaised>(
			`${stageBase(projectId, stageId)}/submissions/${submission}/paid-revision`,
			{ notes },
		);
	},

	/**
	 * Pay for a raised round directly (Decision #199): from the wallet now, or by card — the answer's
	 * handoff is confirmed by the Payment Element and the webhook holds the round's escrow.
	 */
	fundPaidRevision(
		projectId: string,
		stageId: string,
		submissionId: string,
		body: PaidRevisionFundingRequest,
	): Promise<ProjectsResult<PaidRevisionFunding>> {
		const submission = encodeURIComponent(submissionId);
		return postProjects<PaidRevisionFunding>(
			`${stageBase(projectId, stageId)}/submissions/${submission}/paid-revision/fund`,
			body,
		);
	},

	/**
	 * What paying for a raised round directly charges the caller (Decision #436): its own price, or in
	 * their own currency through locked quotes unless `payIn` names the project's.
	 */
	paidRevisionQuote(
		projectId: string,
		stageId: string,
		submissionId: string,
		revisionId: string,
		payIn: string | null = null,
	): Promise<ProjectsResult<{ funding: FundingCharge }>> {
		const query = new URLSearchParams({ revision: revisionId });
		if (payIn) query.set("pay_in", payIn);
		const submission = encodeURIComponent(submissionId);
		return getProjects<{ funding: FundingCharge }>(
			`${stageBase(projectId, stageId)}/submissions/${submission}/paid-revision/quote?${query}`,
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

	/** What ending a stage under Fair Exit would settle at each tier — figures formatted server-side. */
	previewFairExit(projectId: string, stageId: string): Promise<ProjectsResult<FairExitPreview>> {
		return getProjects<FairExitPreview>(`${stageBase(projectId, stageId)}/fair-exit`);
	},

	/**
	 * What cancelling an engagement would settle (Decisions #456, #467) — a brief or a bought service,
	 * every figure the server's.
	 */
	previewProjectCancel(projectId: string): Promise<ProjectsResult<ProjectCancelPreview>> {
		return getProjects<ProjectCancelPreview>(
			`/api/projects/${encodeURIComponent(projectId)}/cancel`,
		);
	},

	/** Cancel an engagement, settling each stage's claimed work at the tier chosen for it. */
	cancelProject(
		projectId: string,
		tiers: Readonly<Record<string, FairExitTier>>,
	): Promise<ProjectsResult<ProjectCancelled>> {
		return postProjects<ProjectCancelled>(`/api/projects/${encodeURIComponent(projectId)}/cancel`, {
			tiers,
		});
	},
};
