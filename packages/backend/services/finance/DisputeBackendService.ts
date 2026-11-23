import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getUserClient, isFinanceBackendLive } from "../../core/supabase.ts";
import { refuseUnlessMoneyLive } from "./money-gate.ts";
import type {
	DisputeCase,
	DisputeQueue,
	DisputeQueueQuery,
	DisputeResolveInput,
	DisputeRespondInput,
	DisputeStatus,
	ReportOrderProblemInput,
} from "@projective/types/finance";
import type { ReadActor } from "../read-actor.ts";
import { type RawDispute, type RawQueue, toDisputeCase, toDisputeQueue } from "./dispute-model.ts";

/**
 * DisputeBackendService — the `DisputeService` PRODUCT_SPEC §Dispute Resolution names (Decision #212):
 * read a case, respond with evidence, escalate to an auditor, and the operator's queue and ruling.
 *
 * It decides nothing. Every rule — who is a party, when a case escalates, what a ruling moves, the
 * attendance audit — is a definer in `00001260_functions_finance_disputes.sql`, called AS the caller
 * (`auth.uid()` and RLS are the gates; the operator door checks `security.is_admin()` itself). A no-show
 * claim is opened through `SessionBackendService.claimNoShow`, and a buyer's report on a downloaded
 * product here ({@link DisputeBackendService.reportOrderProblem}, FBP DB21); the sweep that audits and auto-escalates
 * runs in the database (`finance-dispute-sweep`). Evidence files are served by the files pipeline
 * (`/api/media/proxy/:id`), which `files.fn_can_read` opens to a dispute's parties.
 *
 * Live only: a dispute is money held against a real escrow, so there is no fixture world — the stub
 * answers 503 rather than inventing a case.
 */

// #region Refusals
/** A definer's refusal (SQLSTATE + message) onto a ServiceResult. */
function refusal<T>(
	error: { code?: string; message?: string },
	missing = "That dispute doesn't exist.",
): ServiceResult<T> {
	const message = error.message ?? "That couldn't be done just now.";
	switch (error.code) {
		case "42501":
			return fail(403, { message });
		case "22023":
			return fail(422, { message });
		case "P0002":
			return fail(404, { message: missing });
		case "PS409":
		case "PO409":
			return fail(409, { message });
		default:
			return fail(502, { message: "That couldn't be done just now. Please try again." });
	}
}

/**
 * A dispute READ's gate. A dispute WRITE (respond · escalate · resolve, which can release or
 * refund the held escrow) passes the money switch instead (`refuseUnlessMoneyLive`,
 * `money-gate.ts`).
 */
function gate<T>(actor: ReadActor): ServiceResult<T> | null {
	if (!isFinanceBackendLive()) return fail(503, { message: "Disputes need the live database." });
	if (!actor.accessToken) return fail(401, { message: "Sign in to continue." });
	return null;
}

const UNREACHABLE = fail(503, {
	message: "We couldn't reach disputes just now. Try again in a moment.",
});

/** Run a dispute call; an unexpected failure is a 503, never a throw into the route (FCA N25). */
async function guarded<T>(
	label: string,
	run: () => Promise<ServiceResult<T>>,
): Promise<ServiceResult<T>> {
	try {
		return await run();
	} catch (error) {
		console.error(`[disputes:${label}]`, error instanceof Error ? error.message : error);
		return UNREACHABLE as ServiceResult<T>;
	}
}
// #endregion

export class DisputeBackendService {
	/** The case as the caller may see it (a party or an operator); 404 for anyone else. */
	static get(
		disputeId: string,
		actor: ReadActor,
	): Promise<ServiceResult<{ dispute: DisputeCase }>> {
		return guarded("get", async () => {
			const blocked = gate<{ dispute: DisputeCase }>(actor);
			if (blocked) return blocked;
			const { data, error } = await getUserClient(actor.accessToken!).schema("finance").rpc(
				"get_dispute",
				{
					p_dispute_id: disputeId,
				},
			);
			if (error) return refusal(error);
			const dispute = toDisputeCase(data as RawDispute | null);
			if (!dispute) return fail(404, { message: "That dispute doesn't exist." });
			return ok({ dispute });
		});
	}

	/**
	 * File a statement (with up to ten of the caller's uploaded files) on a live case. The respondent's
	 * statement on an `awaiting_response` case sends it to an auditor.
	 */
	static respond(
		disputeId: string,
		input: DisputeRespondInput,
		actor: ReadActor,
	): Promise<ServiceResult<{ status: DisputeStatus }>> {
		return guarded("respond", async () => {
			const blocked = refuseUnlessMoneyLive<{ status: DisputeStatus }>(actor);
			if (blocked) return blocked;
			const { data, error } = await getUserClient(actor.accessToken!).schema("finance").rpc(
				"respond_to_dispute",
				{
					p_dispute_id: disputeId,
					p_statement: input.statement,
					p_file_ids: input.fileIds,
				},
			);
			if (error) return refusal(error);
			return ok({ status: (data as { status: DisputeStatus }).status }, {
				message: "Your statement was filed.",
			});
		});
	}

	/**
	 * Report a problem with a downloaded digital product while its sale clears (FBP DB21; ruling M8): the
	 * entitlement's slug names the line, read under the caller's JWT, then `finance.open_order_line_dispute`
	 * freezes the seller's clearing earnings and sends the case to an operator. A money write (it holds
	 * money), so the switch comes first.
	 */
	static reportOrderProblem(
		entitlement: string,
		input: ReportOrderProblemInput,
		actor: ReadActor,
	): Promise<ServiceResult<{ disputeId: string; status: DisputeStatus }>> {
		return guarded("report", async () => {
			const blocked = refuseUnlessMoneyLive<{ disputeId: string; status: DisputeStatus }>(actor);
			if (blocked) return blocked;
			const db = getUserClient(actor.accessToken!);
			const { data: row, error: readError } = await db.schema("catalogue").from("entitlements")
				.select("order_line_id").eq("slug", entitlement).maybeSingle();
			if (readError) throw new Error(readError.message);
			if (!row) return fail(404, { message: "That purchase doesn't exist." });
			const { data, error } = await db.schema("finance").rpc("open_order_line_dispute", {
				p_line_id: (row as { order_line_id: string }).order_line_id,
				p_reason: input.reason,
				p_statement: input.statement,
				p_file_ids: input.fileIds,
			});
			if (error) return refusal(error, "That purchase doesn't exist.");
			const out = data as { dispute_id: string; status: DisputeStatus };
			return ok({ disputeId: out.dispute_id, status: out.status }, {
				message: "Reported. The seller's earnings are held while Projective reviews it.",
			});
		});
	}

	/** Send an `awaiting_response` case to an auditor before its deadline (either party). */
	static escalate(
		disputeId: string,
		actor: ReadActor,
	): Promise<ServiceResult<{ status: DisputeStatus }>> {
		return guarded("escalate", async () => {
			const blocked = refuseUnlessMoneyLive<{ status: DisputeStatus }>(actor);
			if (blocked) return blocked;
			const { data, error } = await getUserClient(actor.accessToken!).schema("finance").rpc(
				"escalate_dispute",
				{
					p_dispute_id: disputeId,
				},
			);
			if (error) return refusal(error);
			return ok({ status: (data as { status: DisputeStatus }).status }, {
				message: "Sent to a Projective auditor.",
			});
		});
	}

	/**
	 * The operator queue — every live case (or those in one live status), oldest-due first, with the
	 * whole live set's counts. 403 for anyone but a platform operator (`finance.list_disputes_for_review`
	 * checks `security.is_admin()`); the `/admin/disputes` page answers that with a 404.
	 */
	static queue(
		query: DisputeQueueQuery,
		actor: ReadActor,
	): Promise<ServiceResult<DisputeQueue>> {
		return guarded("queue", async () => {
			const blocked = gate<DisputeQueue>(actor);
			if (blocked) return blocked;
			const { data, error } = await getUserClient(actor.accessToken!).schema("finance").rpc(
				"list_disputes_for_review",
				{ p_status: query.status ?? null },
			);
			if (error) return refusal(error);
			return ok(toDisputeQueue(data as RawQueue | null));
		});
	}

	/** A platform operator's ruling; 403 for anyone else (the definer checks `security.is_admin()`). */
	static resolve(
		disputeId: string,
		input: DisputeResolveInput,
		actor: ReadActor,
	): Promise<ServiceResult<{ status: DisputeStatus }>> {
		return guarded("resolve", async () => {
			const blocked = refuseUnlessMoneyLive<{ status: DisputeStatus }>(actor);
			if (blocked) return blocked;
			const { data, error } = await getUserClient(actor.accessToken!).schema("finance").rpc(
				"resolve_dispute",
				{
					p_dispute_id: disputeId,
					p_outcome: input.outcome,
					p_payee_share_bp: input.payeeShareBp,
					p_notes: input.notes,
				},
			);
			if (error) return refusal(error);
			return ok({ status: (data as { status: DisputeStatus }).status }, {
				message: "Ruling recorded.",
			});
		});
	}
}
