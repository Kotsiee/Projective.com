import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getUserClient, isFinanceBackendLive } from "../../core/supabase.ts";
import type {
	DisputeCase,
	DisputeResolveInput,
	DisputeRespondInput,
	DisputeStatus,
} from "@projective/types/finance";
import type { ReadActor } from "../read-actor.ts";
import { type RawDispute, toDisputeCase } from "./dispute-model.ts";

/**
 * DisputeBackendService — the `DisputeService` PRODUCT_SPEC §Dispute Resolution names (Decision #212):
 * read a case, respond with evidence, escalate to an auditor, and an operator's ruling.
 *
 * It decides nothing. Every rule — who is a party, when a case escalates, what a ruling moves, the
 * attendance audit — is a definer in `00001260_functions_finance_disputes.sql`, called AS the caller
 * (`auth.uid()` and RLS are the gates; the operator door checks `security.is_admin()` itself). A no-show
 * claim is opened through `SessionBackendService.claimNoShow`; the sweep that audits and auto-escalates
 * runs in the database (`finance-dispute-sweep`). Evidence files are served by the files pipeline
 * (`/api/files/object/:id`), which `files.fn_can_read` opens to a dispute's parties.
 *
 * Live only: a dispute is money held against a real escrow, so there is no fixture world — the stub
 * answers 503 rather than inventing a case.
 */

// #region Refusals
/** A definer's refusal (SQLSTATE + message) onto a ServiceResult. */
function refusal<T>(error: { code?: string; message?: string }): ServiceResult<T> {
	const message = error.message ?? "That couldn't be done just now.";
	switch (error.code) {
		case "42501":
			return fail(403, { message });
		case "22023":
			return fail(422, { message });
		case "P0002":
			return fail(404, { message: "That dispute doesn't exist." });
		case "PS409":
			return fail(409, { message });
		default:
			return fail(502, { message: "That couldn't be done just now. Please try again." });
	}
}

function gate<T>(actor: ReadActor): ServiceResult<T> | null {
	if (!isFinanceBackendLive()) return fail(503, { message: "Disputes need the live database." });
	if (!actor.accessToken) return fail(401, { message: "Sign in to continue." });
	return null;
}
// #endregion

export class DisputeBackendService {
	/** The case as the caller may see it (a party or an operator); 404 for anyone else. */
	static async get(
		disputeId: string,
		actor: ReadActor,
	): Promise<ServiceResult<{ dispute: DisputeCase }>> {
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
	}

	/**
	 * File a statement (with up to ten of the caller's uploaded files) on a live case. The respondent's
	 * statement on an `awaiting_response` case sends it to an auditor.
	 */
	static async respond(
		disputeId: string,
		input: DisputeRespondInput,
		actor: ReadActor,
	): Promise<ServiceResult<{ status: DisputeStatus }>> {
		const blocked = gate<{ status: DisputeStatus }>(actor);
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
	}

	/** Send an `awaiting_response` case to an auditor before its deadline (either party). */
	static async escalate(
		disputeId: string,
		actor: ReadActor,
	): Promise<ServiceResult<{ status: DisputeStatus }>> {
		const blocked = gate<{ status: DisputeStatus }>(actor);
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
	}

	/** A platform operator's ruling; 403 for anyone else (the definer checks `security.is_admin()`). */
	static async resolve(
		disputeId: string,
		input: DisputeResolveInput,
		actor: ReadActor,
	): Promise<ServiceResult<{ status: DisputeStatus }>> {
		const blocked = gate<{ status: DisputeStatus }>(actor);
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
	}
}
