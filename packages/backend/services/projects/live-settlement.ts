import type { SupabaseClient } from "supabaseClient";
import type {
	ApproveStage,
	CancelProject,
	CancelStageFairExit,
	FairExitBlocked,
	FairExitPreview,
	FairExitQuote,
	FairExitTier,
	PaidRevisionRaised,
	PreviewProjectCancel,
	PreviewStageFairExit,
	ProjectCancelBlocked,
	ProjectCancelled,
	ProjectCancelPreview,
	ProjectCancelStage,
	ProjectExitQuote,
	RequestPaidRevision,
	ReviewSubmission,
	StageApproved,
	StageExited,
	SubmissionReviewed,
} from "@projective/types/projects";
import { formatMoney } from "@projective/types/finance";
import type { ReadActor } from "../read-actor.ts";
import { clampOr, projectsDb, toSubmissionStatus, UUID_RE } from "./live-support.ts";
import { refusalFrom, type WriteOutcome, type WriteRefusal } from "./live-writes.ts";

/**
 * live-settlement — the RLS-scoped write path for the client decisions that move deliverables and
 * money: a submission verdict, a stage approval, a Fair Exit cancellation and an engagement's
 * cancellation (a brief or a bought service, Decision #467).
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
		case "PC409":
			return {
				status: 409,
				message: say("That is no longer possible."),
				errors: keyed("conflict"),
			};
		case "PU422":
			return {
				status: 422,
				message: say("That request is not valid."),
				errors: keyed("not_allowed"),
			};
		// A dispute stands against money the request would move (FBP DB3): its ruling settles it.
		case "PD409":
			return {
				status: 409,
				message:
					"A dispute is open on money this would move. It is paid or refunded by the ruling.",
				errors: keyed("dispute_open"),
			};
		// Money is still held (Decision #467): it settles first, through Cancel (or, for a session's
		// sittings, through each sitting).
		case "PF409":
			return {
				status: 409,
				message: say("This still holds escrow, so it settles first."),
				errors: keyed("settle_first"),
			};
		// The stage's free revision rounds are used (Decision #167): the client can buy one instead.
		case "PR402":
			return {
				status: 402,
				message: say("The free revisions on this stage are used — buy a revision to send it back."),
				errors: keyed("paid_revision_required"),
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
	const projectId = await resolveProject(db, projectRef);
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

async function resolveProject(db: SupabaseClient, projectRef: string): Promise<string | null> {
	const project = await db
		.from("projects")
		.select("id")
		.eq(UUID_RE.test(projectRef) ? "id" : "slug", projectRef)
		.maybeSingle();
	if (project.error) throw new Error(`projects.projects read failed: ${project.error.message}`);
	return (project.data as { id?: string } | null)?.id ?? null;
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
 * The function updates the submission and writes the activity row; on a revision it raises a
 * `stage_revision_requests` row and bounces the ticket back into progress, and on an acceptance it
 * settles the ticket through the guarded status path and releases its held escrow (Decision #194) —
 * all in one transaction. The notes travel as `{ global }`, the one feedback key the schema reads back.
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

	const payload = data as { status?: string; released_count?: unknown } | null;
	return {
		data: {
			submissionId: input.submissionId,
			stageId: target.stageId,
			status: toSubmissionStatus(
				payload?.status ?? (input.decision === "accept" ? "accepted" : "revisions_requested"),
			),
			releasedCount: cents(payload?.released_count),
		},
	};
}

/**
 * Raise a paid revision round through `projects.request_paid_revision` (Decision #167) — the review's
 * "Buy a revision". Addressed like a verdict (the submission must belong to the URL's stage); the
 * function checks review authority, that the free rounds are used and that the stage sells one.
 */
export async function requestPaidRevisionRow(
	actor: ReadActor & { accessToken: string },
	input: RequestPaidRevision,
): Promise<WriteOutcome<PaidRevisionRaised>> {
	if (!UUID_RE.test(input.submissionId)) return null;
	const db = projectsDb(actor);
	const target = await resolveTarget(db, input.projectId, input.stageId);
	if (!target) return null;

	const row = await db
		.from("stage_submissions")
		.select("id, project_stage_id")
		.eq("id", input.submissionId)
		.maybeSingle();
	if (row.error) throw new Error(`projects.stage_submissions read failed: ${row.error.message}`);
	if ((row.data as { project_stage_id?: string } | null)?.project_stage_id !== target.stageId) {
		return null;
	}

	const { data, error } = await db.rpc("request_paid_revision", {
		p_submission_id: input.submissionId,
		p_feedback: { global: input.notes.trim() },
	});
	if (error) return { refusal: settlementRefusal(error, "decision") };

	const payload = (data ?? {}) as Record<string, unknown>;
	return {
		data: {
			revisionId: String(payload.revision_id ?? ""),
			priceMinor: cents(payload.price_minor),
			currency: clampOr(String(payload.currency ?? ""), 3, "USD"),
			title: clampOr(String(payload.title ?? ""), 200, "Paid revision"),
		},
	};
}
// #endregion

// #region Stage approval
/**
 * Approve a stage through `projects.approve_stage`: complete every ticket still holding escrow on it
 * and release that escrow (fee and team splits applied by the finance engine), mark it `paid`, notify
 * the payees, every team-split recipient and the client, and — when it was the project's last
 * unsettled stage — fire the Contact Handover. The figures cover only this call's releases.
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
			refundedCount: cents(payload.refunded_count),
			refundedCents: cents(payload.refunded_cents),
			handoverUnlocked: payload.handover_unlocked === true,
		},
	};
}
// #endregion

// #region Fair Exit
const FAIR_EXIT_TIERS: readonly FairExitTier[] = [25, 50, 75];

/** A three-letter currency code from the payload, or the fallback. */
function currencyOf(value: unknown, fallback = "USD"): string {
	const code = String(value ?? "").trim().toUpperCase();
	return /^[A-Z]{3}$/.test(code) ? code : fallback;
}

/**
 * Map `projects.cancel_stage_fair_exit`'s answer onto {@link StageExited}. Exported for its tests: the
 * keys are the SQL function's, and a renamed key would otherwise read as a silent zero.
 */
export function toStageExited(
	payload: Record<string, unknown>,
	stageId: string,
	tier: FairExitTier,
): StageExited {
	return {
		stageId,
		status: "cancelled",
		tier,
		cancelledCount: cents(payload.cancelled_count),
		ticketsCancelled: cents(payload.tickets_cancelled),
		freelancerPaidCents: cents(payload.freelancer_paid_cents),
		feeCents: cents(payload.fee_cents),
		clientRefundedCents: cents(payload.client_refunded_cents),
		currency: currencyOf(payload.currency),
	};
}

/** The notice a settled Fair Exit answers with — the figures that moved, in the stage's currency. */
export function fairExitMessage(exited: StageExited): string {
	const paid = formatMoney(exited.freelancerPaidCents, exited.currency);
	const refunded = formatMoney(exited.clientRefundedCents, exited.currency);
	const closed = exited.ticketsCancelled === 0
		? ""
		: exited.ticketsCancelled === 1
		? "; 1 open ticket was cancelled"
		: `; ${exited.ticketsCancelled} open tickets were cancelled`;
	return `Stage ended — ${paid} paid to the freelancer, ${refunded} refunded${closed}.`;
}

/** One tier's quote, labelled in the stage's currency. */
function toFairExitQuote(raw: Record<string, unknown>, tier: FairExitTier, currency: string): FairExitQuote {
	const freelancerPaidCents = cents(raw.freelancer_paid_cents);
	const feeCents = cents(raw.fee_cents);
	const clientRefundedCents = cents(raw.client_refunded_cents);
	return {
		tier,
		ticketCount: cents(raw.ticket_count),
		freelancerPaidCents,
		feeCents,
		clientRefundedCents,
		freelancerPaidLabel: clampOr(formatMoney(freelancerPaidCents, currency), 40, ""),
		feeLabel: clampOr(formatMoney(feeCents, currency), 40, ""),
		clientRefundedLabel: clampOr(formatMoney(clientRefundedCents, currency), 40, ""),
	};
}

/**
 * Map `projects.preview_stage_fair_exit`'s answer onto {@link FairExitPreview}, labelling every figure
 * server-side. Each tier is looked up by its own `tier` key rather than its position, and a tier the
 * function did not answer reads as an empty quote — exported for its tests for the same reason as
 * {@link toStageExited}.
 */
export function toFairExitPreview(payload: Record<string, unknown>, stageId: string): FairExitPreview {
	const currency = currencyOf(payload.currency);
	const raw = Array.isArray(payload.tiers) ? payload.tiers as Record<string, unknown>[] : [];
	const quoteOf = (tier: FairExitTier) => raw.find((q) => Number(q?.tier) === tier) ?? {};
	const blocked: FairExitBlocked | null = payload.blocked === "settled" || payload.blocked === "nothing_held"
		? payload.blocked
		: null;
	const heldCents = cents(payload.held_cents);
	const prepaidCents = cents(quoteOf(50).prepaid_cents);
	return {
		stageId,
		stageName: clampOr(String(payload.stage_name ?? ""), 200, "This stage"),
		currency,
		exitable: payload.exitable === true && blocked === null,
		blocked,
		heldCents,
		heldLabel: clampOr(formatMoney(heldCents, currency), 40, ""),
		prepaidCents,
		prepaidLabel: clampOr(formatMoney(prepaidCents, currency), 40, ""),
		ticketsToCancel: cents(payload.tickets_to_cancel),
		tiers: FAIR_EXIT_TIERS.map((tier) => toFairExitQuote(quoteOf(tier), tier, currency)),
	};
}

/**
 * Read what ending a stage under Fair Exit would settle at each tier, through
 * `projects.preview_stage_fair_exit` — the same quote the door reports, so the confirmation and the
 * settlement agree to the cent. The function checks review authority itself (a 403 for anyone else);
 * the address resolves like every settlement route's.
 */
export async function previewFairExitRow(
	actor: ReadActor & { accessToken: string },
	input: PreviewStageFairExit,
): Promise<WriteOutcome<FairExitPreview>> {
	const db = projectsDb(actor);
	const target = await resolveTarget(db, input.projectId, input.stageId);
	if (!target) return null;

	const { data, error } = await db.rpc("preview_stage_fair_exit", {
		p_project_id: target.projectId,
		p_stage_id: target.stageId,
	});
	if (error) return { refusal: settlementRefusal(error, "stageId") };
	return { data: toFairExitPreview((data ?? {}) as Record<string, unknown>, target.stageId) };
}

/**
 * Cancel a stage under the Fair Exit split through `projects.cancel_stage_fair_exit`: the freelancer
 * is paid `tier`% of each held escrow's principal (net of the fee), the remainder is refunded to the
 * payer, the stage is marked `cancelled`, the tickets left on it close as `cancelled`, and both sides
 * are notified (Decision #198).
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

	return { data: toStageExited((data ?? {}) as Record<string, unknown>, target.stageId, input.tier) };
}
// #endregion

// #region Cancelling an engagement (Decisions #456, #467)
/** The notice a cancelled engagement answers with — what the provider was paid and what came back. */
export function projectCancelledMessage(cancelled: ProjectCancelled): string {
	const noun = cancelled.kind === "service" ? "Service" : "Project";
	const refunded = formatMoney(cancelled.clientRefundedCents, cancelled.currency);
	if (cancelled.freelancerPaidCents === 0) {
		return cancelled.clientRefundedCents === 0
			? `${noun} cancelled.`
			: `${noun} cancelled — ${refunded} refunded to your wallet.`;
	}
	const paid = formatMoney(cancelled.freelancerPaidCents, cancelled.currency);
	return `${noun} cancelled — ${paid} paid for the work delivered, ${refunded} refunded to your wallet.`;
}

function toProjectExitQuote(raw: Record<string, unknown>, tier: FairExitTier): ProjectExitQuote {
	return {
		tier,
		ticketCount: cents(raw.ticket_count),
		freelancerPaidCents: cents(raw.freelancer_paid_cents),
		feeCents: cents(raw.fee_cents),
		clientRefundedCents: cents(raw.client_refunded_cents),
	};
}

const CANCEL_BLOCKS: readonly ProjectCancelBlocked[] = ["ended", "dispute", "sittings", "settling"];

/** A `blocked` the function reported, or `null` — an unknown word is not trusted as a reason. */
function cancelBlockedOf(value: unknown): ProjectCancelBlocked | null {
	return CANCEL_BLOCKS.find((b) => b === value) ?? null;
}

/**
 * Map `projects.preview_project_cancel`'s answer onto {@link ProjectCancelPreview}. A stage whose id is
 * not a uuid is dropped rather than trusted, and each tier is looked up by its own `tier` key — exported
 * for its tests.
 */
export function toProjectCancelPreview(payload: Record<string, unknown>): ProjectCancelPreview {
	const blocked = cancelBlockedOf(payload.blocked);
	const rawStages = Array.isArray(payload.stages)
		? payload.stages as Record<string, unknown>[]
		: [];
	const stages: ProjectCancelStage[] = rawStages
		.filter((s) => UUID_RE.test(String(s?.stage_id ?? "")))
		.slice(0, 60)
		.map((s) => {
			const raw = Array.isArray(s.tiers) ? s.tiers as Record<string, unknown>[] : [];
			const quoteOf = (tier: FairExitTier) => raw.find((q) => Number(q?.tier) === tier) ?? {};
			return {
				stageId: String(s.stage_id),
				stageName: clampOr(String(s.stage_name ?? ""), 200, "Untitled stage"),
				tiers: FAIR_EXIT_TIERS.map((tier) => toProjectExitQuote(quoteOf(tier), tier)),
			};
		});
	return {
		kind: payload.kind === "service" ? "service" : "project",
		currency: currencyOf(payload.currency),
		cancellable: payload.cancellable === true && blocked === null,
		blocked,
		returnedCents: cents(payload.returned_cents),
		ticketsToCancel: cents(payload.tickets_to_cancel),
		stages,
	};
}

/** Map `projects.cancel_project`'s answer onto {@link ProjectCancelled} — exported for its tests. */
export function toProjectCancelled(payload: Record<string, unknown>): ProjectCancelled {
	return {
		status: "cancelled",
		kind: payload.kind === "service" ? "service" : "project",
		currency: currencyOf(payload.currency),
		freelancerPaidCents: cents(payload.freelancer_paid_cents),
		feeCents: cents(payload.fee_cents),
		clientRefundedCents: cents(payload.client_refunded_cents),
		ticketsCancelled: cents(payload.tickets_cancelled),
	};
}

/**
 * Read what cancelling an engagement would settle, through `projects.preview_project_cancel`. The
 * function checks review authority itself (a 403 for anyone else, the provider included).
 */
export async function previewProjectCancelRow(
	actor: ReadActor & { accessToken: string },
	input: PreviewProjectCancel,
): Promise<WriteOutcome<ProjectCancelPreview>> {
	const db = projectsDb(actor);
	const projectId = await resolveProject(db, input.projectId);
	if (!projectId) return null;

	const { data, error } = await db.rpc("preview_project_cancel", { p_project_id: projectId });
	if (error) return { refusal: settlementRefusal(error, "projectId") };
	return { data: toProjectCancelPreview((data ?? {}) as Record<string, unknown>) };
}

/**
 * Cancel an engagement through `projects.cancel_project`, the one settle-first door (Decision #467):
 * unclaimed escrow back whole, claimed work settled under Fair Exit at each stage's tier, the open
 * tickets and stages closed, then Cancelled. An open dispute is a 409 (`dispute_open`), a session's
 * sitting escrow a 409 (`settle_first`).
 */
export async function cancelProjectRow(
	actor: ReadActor & { accessToken: string },
	input: CancelProject,
): Promise<WriteOutcome<ProjectCancelled>> {
	const db = projectsDb(actor);
	const projectId = await resolveProject(db, input.projectId);
	if (!projectId) return null;

	const { data, error } = await db.rpc("cancel_project", {
		p_project_id: projectId,
		p_tiers: input.tiers,
		p_reason: input.reason ?? null,
	});
	if (error) return { refusal: settlementRefusal(error, "tiers") };
	return { data: toProjectCancelled((data ?? {}) as Record<string, unknown>) };
}
// #endregion
