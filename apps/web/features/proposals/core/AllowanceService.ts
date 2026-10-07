import {
	type ProposalAllowanceStatus,
	ProposalAllowanceStatusSchema,
} from "@projective/types/finance";
import type {
	ApplicationWithdrawn,
	ApplyToProject,
	ProjectApplication,
	SentApplication,
} from "@projective/types/projects";
import { getProjects, postProjects } from "@features/projects/core/api.ts";
import type { ProjectsResult } from "@features/projects/types/results.ts";

/** What a status read answers: the status, or why there is none. */
export interface AllowanceRead {
	ok: boolean;
	status: ProposalAllowanceStatus | null;
	/** The HTTP status — 403 means "not a member of that team". */
	code: number;
	message?: string;
}

/**
 * AllowanceService — the THIN client of the proposal allowance and the applicant's side of a proposal
 * (`GET /api/user/allowance`, `GET /api/projects/applications/mine`, `POST /api/projects/apply`,
 * `POST /api/projects/applications/withdraw`). Islands never reach the backend; every rule — which
 * subject, whether to refuse, the refund — is the fat service's.
 *
 * The status read is CHROME (the header popover renders on public routes too), so it uses a plain
 * `fetch` that degrades to `null` like `AccountService`: a guest or an expired session must not be
 * redirected to sign-in by a meter. The writes go through the projects transport (`apiFetch`), which
 * refreshes an expired token before giving up.
 */
export const AllowanceService = {
	/**
	 * The acting subject's allowance; a named team's (`{ teamId }`); or the person's own even in a team
	 * context (`{ personal: true }`). Parsed against the SSOT.
	 */
	async status(
		subject: { teamId?: string | null; personal?: boolean } = {},
	): Promise<AllowanceRead> {
		try {
			const qs = subject.teamId
				? `?team=${encodeURIComponent(subject.teamId)}`
				: subject.personal
				? "?as=self"
				: "";
			const res = await fetch(`/api/user/allowance${qs}`, {
				headers: { accept: "application/json" },
				cache: "no-store",
			});
			const body = await res.json().catch(() => null) as
				| { ok?: boolean; data?: unknown; message?: string }
				| null;
			const parsed = ProposalAllowanceStatusSchema.safeParse(body?.data);
			return {
				ok: res.ok && parsed.success,
				status: parsed.success ? parsed.data : null,
				code: res.status,
				message: body?.message,
			};
		} catch {
			return { ok: false, status: null, code: 0, message: "Network error — please try again." };
		}
	},

	/** The proposals the viewer has sent, newest first; narrowed to one project when given. */
	sent(project?: string): Promise<ProjectsResult<SentApplication[]>> {
		const qs = project ? `?project=${encodeURIComponent(project)}` : "";
		return getProjects<SentApplication[]>(`/api/projects/applications/mine${qs}`);
	},

	/** Apply to a stage — as yourself, or for a team you may bind (`teamId`). */
	apply(payload: ApplyToProject): Promise<ProjectsResult<ProjectApplication>> {
		return postProjects<ProjectApplication>("/api/projects/apply", payload);
	},

	/** Withdraw a pending proposal; one weekly proposal comes back. */
	withdraw(applicationId: string): Promise<ProjectsResult<ApplicationWithdrawn>> {
		return postProjects<ApplicationWithdrawn>("/api/projects/applications/withdraw", {
			applicationId,
		});
	},
};
