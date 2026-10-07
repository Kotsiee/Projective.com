import { z } from "zod";
import { HIRE_MESSAGE_MAX } from "./hire.ts";

/**
 * projects.apply — the freelancer-led half of the hiring handshake (PRODUCT_SPEC §The Hiring Process,
 * "The Inbound Request") and the two answers that close a request: the invitee's to an invitation,
 * and the client's to an application.
 *
 * Each request is written by a definer RPC (`projects.apply_to_project`,
 * `projects.respond_to_project_invitation`, `projects.assign_from_application`) that notifies the
 * other side through `comms.fn_notify`; a cover note or an intro then opens the pair's DM through
 * `comms.send_request_message`, which files it in the recipient's Requests folder.
 */

// #region Apply
/** `POST /api/projects/apply`. */
export const ApplyToProjectSchema = z.object({
	/** The project's slug (`prj-…`). */
	projectId: z.string().trim().min(1).max(120),
	/** The stage's slug (`stg-…`) or id. */
	stageId: z.string().trim().min(1).max(120),
	/** One of the stage's staffing roles, when the stage lists them. */
	roleId: z.string().trim().min(1).max(120).nullable().default(null),
	/** The cover note, plain text; it becomes the request's opening message. */
	message: z.string().max(HIRE_MESSAGE_MAX).default(""),
	/**
	 * Apply on a TEAM's behalf instead of as yourself. Only a member who may bind the team to work
	 * (`bind_seat`) may, and the team needs two active members; the proposal is metered against the
	 * team's pool. `null` applies as the signed-in person.
	 */
	teamId: z.string().uuid().nullable().default(null),
});
export type ApplyToProject = z.infer<typeof ApplyToProjectSchema>;

/** A recorded application. */
export interface ProjectApplication {
	id: string;
	/** The project's slug. */
	projectId: string;
	stageId: string;
	roleId: string | null;
	/** Who applied: the person, or a team they bound. */
	applicantType: ApplicantType;
	/** The team that applied, when {@link applicantType} is `team`. */
	teamId: string | null;
	status: "pending";
	/** The note as stored — PII-masked while the project is protected. */
	message: string | null;
	/** The conversation the note opened with the client; null when there was no note to post. */
	conversationId: string | null;
}
// #endregion

// #region The applicant's side — sent proposals and withdrawal
/** `projects.project_applications.applicant_type`. */
export const ApplicantType = z.enum(["freelancer", "team"]);
export type ApplicantType = z.infer<typeof ApplicantType>;

/** `projects.application_status`. */
export const ApplicationStatus = z.enum(["pending", "accepted", "rejected", "withdrawn"]);
export type ApplicationStatus = z.infer<typeof ApplicationStatus>;

/**
 * One proposal the viewer sent (or one filed for a team they belong to) — a row of
 * `projects.list_my_applications`, which `GET /api/projects/applications/mine` returns newest first.
 */
export const SentApplicationSchema = z.object({
	id: z.string(),
	status: ApplicationStatus,
	applicantType: ApplicantType,
	teamId: z.string().nullable(),
	teamName: z.string().nullable(),
	/** Whether the viewer may withdraw it — they filed it, or may bind the applying team. */
	canWithdraw: z.boolean(),
	projectSlug: z.string(),
	projectTitle: z.string(),
	stageSlug: z.string().nullable(),
	stageName: z.string().nullable(),
	roleTitle: z.string().nullable(),
	createdAt: z.string(),
});
export type SentApplication = z.infer<typeof SentApplicationSchema>;

/** `GET /api/projects/applications/mine?project=` — narrows to one project when given. */
export const SentApplicationsQuerySchema = z.object({
	project: z.string().trim().min(1).max(120).optional(),
});
export type SentApplicationsQuery = z.infer<typeof SentApplicationsQuerySchema>;

/**
 * `POST /api/projects/applications/withdraw` — the applicant takes a pending proposal back. The
 * status flip refunds one weekly proposal unit (the anti-burst buffer token is not returned).
 */
export const WithdrawApplicationSchema = z.object({
	applicationId: z.string().trim().min(1).max(120),
});
export type WithdrawApplication = z.infer<typeof WithdrawApplicationSchema>;

/** The withdrawn application. */
export interface ApplicationWithdrawn {
	id: string;
	status: "withdrawn";
	/** Weekly proposal units returned to the applicant. */
	refunded: number;
}
// #endregion

// #region Answers
/**
 * `POST /api/projects/invites/respond` — the invitee answers a request. A multi-stage hire is one
 * request to the person receiving it, so every invitation it issued is answered together.
 */
export const RespondToInvitationSchema = z.object({
	invitationIds: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
	accept: z.boolean(),
});
export type RespondToInvitation = z.infer<typeof RespondToInvitationSchema>;

/** What each answered invitation became. */
export interface InvitationAnswered {
	answered: { id: string; status: "accepted" | "declined" }[];
}

/** `POST /api/projects/applications/accept` — the client confirms an applicant's seat. */
export const AcceptApplicationSchema = z.object({
	applicationId: z.string().trim().min(1).max(120),
});
export type AcceptApplication = z.infer<typeof AcceptApplicationSchema>;

/** The confirmed seat. */
export interface ApplicationAccepted {
	id: string;
	status: "accepted";
	/** Where the client funds the seat it just confirmed. */
	fundHref: string;
}

/**
 * `POST /api/projects/applications/reject` — the client declines an applicant. The application becomes
 * `rejected` (the status a filled seat already gives its other applicants) and the applicant is told.
 */
export const RejectApplicationSchema = z.object({
	applicationId: z.string().trim().min(1).max(120),
});
export type RejectApplication = z.infer<typeof RejectApplicationSchema>;

/** The declined application. */
export interface ApplicationRejected {
	id: string;
	status: "rejected";
}
// #endregion
