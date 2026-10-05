import type { SupabaseClient } from "supabaseClient";
import type {
	ApproveStage,
	CancelStageFairExit,
	ReviewSubmission,
	StageApproved,
	StageExited,
	SubmissionReviewed,
} from "@projective/types/projects";
import type { ReadActor } from "../read-actor.ts";
import { clampOr, projectsDb, toSubmissionStatus, UUID_RE } from "./live-support.ts";
import { refusalFrom, type WriteOutcome, type WriteRefusal } from "./live-writes.ts";

/**
 * live-settlement — the RLS-scoped write path for the three client decisions that move deliverables
 * and money: a submission verdict, a stage approval, and a Fair Exit cancellation.
 *
 * Every write here is ONE call to a guarded SECURITY DEFINER door — `projects.review_submission`,
 * `projects.approve_stage`, `projects.cancel_stage_fair_exit` — issued under the caller's own JWT, so
 * `auth.uid()` inside the function is the person who pressed the button. Each door checks review
 * authority (`projects.can_review_project`: the owner or an active member of the paying client
 * business) before anything moves. That check is the security of this path. Nothing in this module
 * repeats it, because a TypeScript mirror of an authority check is a second opinion that can only
 * ever be wrong in the direction of letting someone through.
 *
 * What this module DOES own is addressing: the routes carry a project slug and a stage slug-or-uuid,
 * the functions take uuids, and a submission id in a URL must actually belong to the stage that URL
 * names. Those are resolved here through ordinary RLS-scoped reads, so an address the caller cannot
 * see resolves to `null` (a 404) exactly as a non-existent one does.
 */

// #region Error mapping
/** The PostgREST error fields this module reads. `code` is the SQLSTATE the function raised. */
interface PgError {
	message: string;
	code?: string | null;
}

/**
 * Map a failed RPC onto a refusal, by SQLSTATE first and by sentence second.
 *
 * The SQLSTATE is the function's own statement of what kind of "no" this is, and it survives a
 * reworded message. The sentence fallback exists because several raises in these functions use the
 * default `P0001` with no errcode, and for those the wording is the only signal there is. Anything
 * unrecognised falls through to the domain's shared {@link refusalFrom}, which owns the stale-token,
 * schema-fault and generic cases and logs the original.
 *
 * The database's own words are passed through for a refusal of THIS caller or THIS request — they
 * are written for a reader ("Only the client/owner may approve this stage.") — and clamped, because
 * they are unbounded text.
 */
export function settlementRefusal(error: PgError, field?: string): WriteRefusal {
	const message = error.message ?? "";
	const say = (fallback: string) => clampOr(message, 200, fallback);
	const keyed = (value: string) => (field ? { [field]: value } : undefined);

	switch (error.code) {
		case "42501":
			// A GRANT-level refusal names the function it failed on; only the body's own sentences are
			// written for a reader (see `refusalFrom`).
			return {
				status: 403,
				message: message.includes("permission denied")
					? "You cannot make that decision."
					: say("You cannot make that decision."),
				errors: keyed("not_permitted"),
			};
		case "P0002":
			return { status: 404, message: say("That no longer exists."), errors: keyed("not_found") };
		case "22023":
		case "23514":
			return {
				status: 422,
				message: say("That request is not valid."),
				errors: keyed("not_allowed"),
			};
		case "55000":
			return {
				status: 409,
				message: say("That is no longer possible."),
				errors: keyed("conflict"),
			};
	}

	if (message.includes("not found")) {
		return { status: 404, message: say("That no longer exists."), errors: keyed("not_found") };
	}
	if (message.includes("No funded (held) escrow")) {
		return {
			status: 409,
			message: say("There is no held escrow on this stage."),
			errors: keyed("conflict"),
		};
	}
	if (message.includes("Fair-exit tier") || message.includes("Unsupported review decision")) {
		return {
			status: 422,
			message: say("That request is not valid."),
			errors: keyed("not_allowed"),
		};
	}
	return refusalFrom(message, field);
}
// #endregion

// #region Addressing
/** The canonical ids a settlement route's address resolves to. */
interface SettlementTarget {
	projectId: string;
	stageId: string;
}

/**
 * Resolve a route's `(project, stage)` address to the two uuids the functions take, or `null`.
 *
 * The project is addressed by its slug (Decision #88); a uuid is accepted on shape alone, because the
 * submissions read echoes whichever form it was asked with. The stage is addressed by its `stg-…` slug
 * or its uuid and is ALWAYS looked up inside the resolved project — a stage of another engagement must
 * not be addressable through this engagement's URL, even though the function would refuse it later.
 *
 * Throws on a genuine read failure (the caller's `liveWrite` turns that into a 502) and returns `null`
 * for an address that matches nothing this viewer may see.
 */
async function resolveTarget(
	db: SupabaseClient,
	projectRef: string,
	stageRef: string,
): Promise<SettlementTarget | null> {
	const project = await db
		.from("projects")
		.select("id")
		.eq(UUID_RE.test(projectRef) ? "id" : "slug", projectRef)
		.maybeSingle();
	if (project.error) throw new Error(`projects.projects read failed: ${project.error.message}`);
	const projectId = (project.data as { id?: string } | null)?.id;
	if (!projectId) return null;

	const stage = await db
		.from("project_stages")
		.select("id")
		.eq("project_id", projectId)
		.eq(UUID_RE.test(stageRef) ? "id" : "slug", stageRef)
		.maybeSingle();
	if (stage.error) throw new Error(`projects.project_stages read failed: ${stage.error.message}`);
	const stageId = (stage.data as { id?: string } | null)?.id;
	return stageId ? { projectId, stageId } : null;
}

/** A non-negative integer from a jsonb number (bigints arrive as numbers or numeric strings). */
function cents(value: unknown): number {
	const n = Math.trunc(Number(value ?? 0));
	return Number.isFinite(n) && n > 0 ? n : 0;
}
// #endregion

// #region Submission review
/**
 * Record a reviewer's verdict on one submission through `projects.review_submission`.
 *
 * The function updates the submission, raises a `stage_revision_requests` row and bounces the ticket
 * back into progress on a revision, and writes the activity row — all in one transaction. The notes
 * travel as `{ global }`, the one feedback key the schema reads back.
 *
 * One check runs BEFORE the call, and it is about the address rather than authority: the submission
 * must belong to the stage the URL names, otherwise the URL is lying about what is being reviewed.
 * Whether it is still awaiting review is the FUNCTION's check (`55000` → 409), deliberately not
 * repeated here: it runs after the review-authority check, so a non-reviewer is told 403 rather than
 * learning the submission's state from a 409 — a TypeScript pre-check would invert that order.
 */
export async function reviewSubmissionRow(
	actor: ReadActor & { accessToken: string },
	input: ReviewSubmission,
): Promise<WriteOutcome<SubmissionReviewed>> {
	if (!UUID_RE.test(input.submissionId)) return null;
	const db = projectsDb(actor);
	const target = await resolveTarget(db, input.projectId, input.stageId);
	if (!target) return null;

	const row = await db
		.from("stage_submissions")
		.select("id, project_stage_id, status")
		.eq("id", input.submissionId)
		.maybeSingle();
	if (row.error) throw new Error(`projects.stage_submissions read failed: ${row.error.message}`);
	const submission = row.data as { project_stage_id?: string } | null;
	if (!submission || submission.project_stage_id !== target.stageId) return null;

	const notes = input.notes.trim();
	const { data, error } = await db.rpc("review_submission", {
		p_submission_id: input.submissionId,
		p_decision: input.decision,
		p_feedback: notes ? { global: notes } : null,
	});
	if (error) return { refusal: settlementRefusal(error, "decision") };

	const payload = data as { status?: string } | null;
	return {
		data: {
			submissionId: input.submissionId,
			stageId: target.stageId,
			status: toSubmissionStatus(
				payload?.status ?? (input.decision === "accept" ? "accepted" : "revisions_requested"),
			),
		},
	};
}
// #endregion

// #region Stage approval
/**
 * Approve a stage through `projects.approve_stage`: release every held escrow on it (fee and team
 * splits applied by the finance engine), mark it `paid`, notify its assignees, and — when it was the
 * project's last unsettled stage — fire the Contact Handover.
 */
export async function approveStageRow(
	actor: ReadActor & { accessToken: string },
	input: ApproveStage,
): Promise<WriteOutcome<StageApproved>> {
	const db = projectsDb(actor);
	const target = await resolveTarget(db, input.projectId, input.stageId);
	if (!target) return null;

	const { data, error } = await db.rpc("approve_stage", {
		p_project_id: target.projectId,
		p_stage_id: target.stageId,
	});
	if (error) return { refusal: settlementRefusal(error, "stageId") };

	const payload = (data ?? {}) as Record<string, unknown>;
	return {
		data: {
			stageId: target.stageId,
			status: "paid",
			releasedCount: cents(payload.released_count),
			totalPaidCents: cents(payload.total_paid_cents),
			feeCents: cents(payload.fee_cents),
			handoverUnlocked: payload.handover_unlocked === true,
		},
	};
}
// #endregion

// #region Fair Exit
/**
 * Cancel a stage under the Fair Exit split through `projects.cancel_stage_fair_exit`: the freelancer
 * is paid `tier`% of each held escrow's principal (net of the fee), the remainder is refunded to the
 * payer, and the stage is marked `cancelled`.
 */
export async function exitStageRow(
	actor: ReadActor & { accessToken: string },
	input: CancelStageFairExit,
): Promise<WriteOutcome<StageExited>> {
	const db = projectsDb(actor);
	const target = await resolveTarget(db, input.projectId, input.stageId);
	if (!target) return null;

	const { data, error } = await db.rpc("cancel_stage_fair_exit", {
		p_project_id: target.projectId,
		p_stage_id: target.stageId,
		p_tier: input.tier,
	});
	if (error) return { refusal: settlementRefusal(error, "tier") };

	const payload = (data ?? {}) as Record<string, unknown>;
	return {
		data: {
			stageId: target.stageId,
			status: "cancelled",
			tier: input.tier,
			cancelledCount: cents(payload.cancelled_count),
			freelancerPaidCents: cents(payload.freelancer_paid_cents),
			clientRefundedCents: cents(payload.client_refunded_cents),
		},
	};
}
// #endregion
