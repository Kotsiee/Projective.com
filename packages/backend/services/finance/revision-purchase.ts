import type { FundPaidRevision, PaidRevisionFunding } from "@projective/types/finance";
import { formatMoney } from "@projective/types/finance";
import { AGE_RESTRICTED, isAgeRestricted } from "../../core/age-gate.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { isFinanceBackendLive } from "../../core/supabase.ts";
import { projectsDb } from "../projects/live-support.ts";
import type { ResolvedOwner } from "./commerce-owner.ts";
import { PaymentBackendService } from "./PaymentBackendService.ts";

/**
 * revision-purchase — paying for ONE paid revision round (Decision #167), through the basket's
 * `paid_revision` line or straight from the review (Decision #199).
 *
 * Every path ends in `projects.fund_paid_revision`, which locks the round, checks the caller may spend
 * the project client's money, holds the round's escrow from the Available balance and only then sends
 * the work back. The checks here are the ones a caller can see before that door, so a refusal is
 * worded for the buyer instead of arriving as a database sentence; the door re-checks all of them.
 */

// #region Pure gates
/** The project columns that decide who pays for its rounds and in what currency. */
export interface RevisionProjectFact {
	id: string;
	slug: string;
	currency: string;
	client_business_id: string | null;
	owner_user_id: string;
}

/** A paid revision round as `projects.stage_revision_requests` stores it. */
export interface RevisionFact {
	id: string;
	status: string;
	price_cents: number | string | null;
	project_stage_id: string;
}

/** A round's facts for a direct payment: its submission, and its stage's current extra-round price. */
export interface RevisionFundingFacts {
	revision: RevisionFact & { submission_id: string | null; request_type: string };
	stage: { id: string; slug: string | null; extra_revision_price_cents: number | string | null };
	project: RevisionProjectFact;
}

/** A refusal the route echoes: an HTTP status and a sentence for the buyer. */
export interface RevisionRefusal {
	status: number;
	message: string;
}

interface Price {
	minor: number;
	currency: string;
}

/** Whether this owner is the project's client — its business, else its owner as an individual. */
export function paysFor(
	project: Pick<RevisionProjectFact, "client_business_id" | "owner_user_id">,
	owner: Pick<ResolvedOwner, "ownerType" | "ownerId" | "isEntity">,
): boolean {
	return owner.isEntity
		? owner.ownerType === "business" && project.client_business_id === owner.ownerId
		: !project.client_business_id && project.owner_user_id === owner.ownerId;
}

function minorOf(value: number | string | null): number | null {
	if (value === null) return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

/**
 * Whether a paid revision round can be bought by this owner now — the gates
 * `projects.fund_paid_revision` applies at payment, as far as the basket can see them. The price is the
 * round's own snapshot, taken when the client raised it. `closed` is `null` while it can be bought.
 */
export function revisionPurchase(
	revision: Pick<RevisionFact, "status" | "price_cents">,
	project: Pick<RevisionProjectFact, "client_business_id" | "owner_user_id" | "currency">,
	owner: Pick<ResolvedOwner, "ownerType" | "ownerId" | "isEntity">,
): { price: Price | null; closed: string | null } {
	const minor = minorOf(revision.price_cents);
	const price = minor !== null && minor > 0 ? { minor, currency: project.currency } : null;
	const closed = !paysFor(project, owner)
		? "Pay for this revision from the account that owns its project."
		: revision.status !== "awaiting_payment"
		? "This revision is no longer waiting for payment."
		: !price
		? "This revision isn't priced."
		: null;
	return { price, closed };
}

/**
 * Whether a direct payment for this round (Decision #199) may go ahead: the round belongs to the
 * route's project, stage and submission, it is still awaiting payment at the stage's current
 * extra-round price, and that price is the one the payer was shown. `null` when it may.
 */
export function revisionFundingCheck(
	facts: RevisionFundingFacts,
	input: Pick<
		FundPaidRevision,
		"projectId" | "stageId" | "submissionId" | "expectedAmountMinor" | "currency"
	>,
): RevisionRefusal | null {
	const { revision, stage, project } = facts;
	const projectMatches = input.projectId === project.id || input.projectId === project.slug;
	const stageMatches = input.stageId === stage.id || input.stageId === stage.slug;
	if (
		!projectMatches || !stageMatches || revision.project_stage_id !== stage.id ||
		revision.submission_id !== input.submissionId
	) {
		return { status: 404, message: "We couldn't find that revision — it may have been withdrawn." };
	}
	if (revision.request_type !== "paid_revision" || revision.status !== "awaiting_payment") {
		return { status: 409, message: "This revision is no longer waiting for payment." };
	}
	const price = minorOf(revision.price_cents);
	if (price === null || price <= 0) return { status: 409, message: "This revision isn't priced." };
	if (price !== minorOf(stage.extra_revision_price_cents)) {
		return {
			status: 409,
			message: "This stage's revision price changed since the round was raised — buy the revision again.",
		};
	}
	const currency = project.currency.toUpperCase();
	if (input.expectedAmountMinor !== price || input.currency.toUpperCase() !== currency) {
		return {
			status: 409,
			message: `This revision now costs ${formatMoney(price, currency)}. Review it and try again.`,
		};
	}
	return null;
}

/** The buyer-facing refusal for an error `projects.fund_paid_revision` raised. */
export function walletFundingRefusal(error: { code?: string; message: string }): RevisionRefusal {
	if (isAgeRestricted(error)) return { status: AGE_RESTRICTED.status, message: AGE_RESTRICTED.message };
	const said = error.message.replace(/\s+/g, " ").trim().slice(0, 300);
	switch (error.code) {
		case "PF402":
			return {
				status: 402,
				message: /spending limit/.test(said)
					? "This would exceed your spending limit on the business wallet."
					: "Your wallet's available balance doesn't cover this revision — pay by card instead.",
			};
		case "42501":
			return { status: 403, message: said || "You can't pay for this revision." };
		case "P0002":
			return { status: 404, message: "We couldn't find that revision — it may have been withdrawn." };
		case "PC409":
			return { status: 409, message: said || "This revision can no longer be paid for." };
		case "23514":
			return { status: 409, message: "This ticket has nobody to pay for the revision yet." };
		default:
			return { status: 500, message: "That didn't go through. Try again in a moment." };
	}
}
// #endregion

// #region Reads
/**
 * The round, its stage and its project, read as the caller through RLS (`View revisions`: review
 * authority, the assignee, the submitter). A round the caller cannot see reads as `null`.
 */
async function readFundingFacts(
	actor: ReadActor & { accessToken: string },
	revisionId: string,
): Promise<RevisionFundingFacts | null> {
	const db = projectsDb(actor);
	const round = await db.from("stage_revision_requests")
		.select("id, status, price_cents, project_stage_id, submission_id, request_type")
		.eq("id", revisionId).maybeSingle();
	if (round.error) throw new Error(`projects.stage_revision_requests read failed: ${round.error.message}`);
	const revision = round.data as RevisionFundingFacts["revision"] | null;
	if (!revision) return null;

	const stageRead = await db.from("project_stages")
		.select("id, slug, project_id, extra_revision_price_cents")
		.eq("id", revision.project_stage_id).maybeSingle();
	if (stageRead.error) throw new Error(`projects.project_stages read failed: ${stageRead.error.message}`);
	const stage = stageRead.data as (RevisionFundingFacts["stage"] & { project_id: string }) | null;
	if (!stage) return null;

	const projectRead = await db.from("projects")
		.select("id, slug, currency, client_business_id, owner_user_id")
		.eq("id", stage.project_id).maybeSingle();
	if (projectRead.error) throw new Error(`projects.projects read failed: ${projectRead.error.message}`);
	const project = projectRead.data as RevisionProjectFact | null;
	return project ? { revision, stage, project: { ...project, currency: project.currency ?? "USD" } } : null;
}
// #endregion

// #region Direct payment
async function fundByCard(
	input: FundPaidRevision,
	facts: RevisionFundingFacts,
	actor: ReadActor,
): Promise<ServiceResult<PaidRevisionFunding>> {
	const begun = await PaymentBackendService.createPaidRevisionIntent({
		projectId: facts.project.id,
		stageId: facts.stage.id,
		revisionId: facts.revision.id,
		expectedAmountMinor: input.expectedAmountMinor,
		currency: input.currency,
		idempotencyKey: input.idempotencyKey,
	}, actor);
	if (!begun.ok || !begun.data) {
		return fail(begun.status, { message: begun.message, errors: begun.errors, details: begun.details });
	}
	return ok({ method: "card", revisionId: facts.revision.id, handoff: begun.data }, {
		message: "Confirm the card to pay for the revision.",
	});
}

async function fundFromWallet(
	facts: RevisionFundingFacts,
	actor: ReadActor & { accessToken: string },
): Promise<ServiceResult<PaidRevisionFunding>> {
	const { data, error } = await projectsDb(actor).rpc("fund_paid_revision", { p_revision_id: facts.revision.id });
	if (error) {
		const refused = walletFundingRefusal(error);
		if (refused.status === 500) console.error("[revision-purchase:wallet]", error.code, error.message);
		return fail(refused.status, { message: refused.message });
	}
	const escrowId = (data as { escrow_id?: string | null } | null)?.escrow_id ?? null;
	return ok({ method: "wallet", revisionId: facts.revision.id, escrowId }, {
		message: "Revision paid for from your wallet — the work is back with the freelancer.",
	});
}

/** The thin `POST …/submissions/:submissionId/paid-revision/fund` route's service (Decision #199). */
export class RevisionPurchaseBackendService {
	/**
	 * Pay for one paid revision round straight from the review. `wallet` holds the round's escrow from
	 * the payer's Available balance now (`projects.fund_paid_revision`); `card` answers with a
	 * PaymentIntent whose signed webhook credits the payer's wallet and runs the same function as the
	 * payer. Nothing is sent back to the freelancer until that hold succeeds. A wallet retry after a
	 * success is refused 409 by the function's own status check, so it never holds twice.
	 */
	static async fundPaidRevision(
		input: FundPaidRevision,
		actor: ReadActor,
	): Promise<ServiceResult<PaidRevisionFunding>> {
		if (!canReadLive(actor)) return fail(401, { message: "Sign in to pay for this revision." });
		if (!isFinanceBackendLive()) {
			return fail(503, { message: "Paying for revisions isn't connected in this environment." });
		}
		try {
			const facts = await readFundingFacts(actor, input.revisionId);
			if (!facts) {
				return fail(404, { message: "We couldn't find that revision — it may have been withdrawn." });
			}
			const refusal = revisionFundingCheck(facts, input);
			if (refusal) return fail(refusal.status, { message: refusal.message });
			return input.method === "card" ? await fundByCard(input, facts, actor) : await fundFromWallet(facts, actor);
		} catch (error) {
			console.error("[revision-purchase:fund]", error instanceof Error ? error.message : error);
			return fail(503, { message: "We couldn't reach this revision just now. Try again in a moment." });
		}
	}
}
// #endregion
