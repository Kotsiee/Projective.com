import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getServiceClient, getUserClient, isFinanceBackendLive } from "../../core/supabase.ts";
import { copyObject } from "../../core/storage-signed.ts";
import { renderPdf } from "../../core/pdf.ts";
import { refuseUnlessMoneyLive } from "./money-gate.ts";
import {
	type DisputeCase,
	type DisputeOfferInput,
	type DisputeQueue,
	type DisputeQueueQuery,
	type DisputeResolveInput,
	type DisputeRespondInput,
	type DisputeStatus,
	type DisputeVaultRead,
	type OpenTicketDisputeInput,
	type ReportOrderProblemInput,
	type TicketDisputeState,
	TicketDisputeStateSchema,
} from "@projective/types/finance";
import type { ReadActor } from "../read-actor.ts";
import { vaultLocation } from "@projective/types/files";
import {
	type RawDispute,
	type RawQueue,
	toDisputeCase,
	toDisputeQueue,
	toDisputeVaultRead,
	type VaultFile,
	vaultFilesOf,
} from "./dispute-model.ts";
import type { RenderedDocument } from "./finance-documents.ts";
import { disputeSummaryDocument, disputeSummaryFilename } from "./dispute-summary-pdf.ts";

/**
 * DisputeBackendService — the `DisputeService` PRODUCT_SPEC §Dispute Resolution names (Decision #212):
 * read a case, respond with evidence, escalate to an auditor, and the operator's queue and ruling.
 *
 * It decides nothing. Every rule — who is a party, when a case escalates, what a ruling moves, the
 * attendance audit — is a definer in `00001260_functions_finance_disputes.sql`, called AS the caller
 * (`auth.uid()` and RLS are the gates; the operator door checks `security.is_admin()` itself). A no-show
 * claim is opened through `SessionBackendService.claimNoShow`, a buyer's report on a downloaded
 * product here ({@link DisputeBackendService.reportOrderProblem}, FBP DB21), and either side's dispute on
 * a ticket's money here too ({@link DisputeBackendService.open}, with its offers, PROJECTS EX2); the
 * sweep that audits and auto-escalates
 * runs in the database (`finance-dispute-sweep`). Evidence files are served by the files pipeline
 * (`/api/media/proxy/:id`), which `files.fn_can_read` opens to a dispute's parties. A ticket case's
 * Evidence Vault (PROJECTS EX3) is frozen by the raise itself; this service copies its files' bytes
 * into the `evidence` bucket and reads it back, with the case summary PDF.
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
		case "PD409":
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

// #region The Evidence Vault
/**
 * Copy a vault's files into the `evidence` bucket under `vault/{disputeId}/` and stamp it ready
 * (`finance.mark_dispute_vault_ready`, service role: no client can say the bytes were copied). What is
 * already there is skipped, so a retry finishes a copy cut short; false leaves the vault pending, and
 * never fails the raise that froze it.
 */
async function sealVault(disputeId: string, files: readonly VaultFile[]): Promise<boolean> {
	try {
		const service = getServiceClient();
		const { data: present } = await service.storage.from("evidence")
			.list(`vault/${disputeId}`, { limit: 1000 });
		const have = new Set((present ?? []).map((o) => o.name));
		for (const f of files) {
			if (have.has(f.file_id)) continue;
			const to = vaultLocation(disputeId, f.file_id);
			if (!(await copyObject(f.bucket, f.path, to.bucket, to.path))) {
				console.error(
					`[disputes:vault] ${disputeId}: copying ${f.file_id} failed; the vault stays pending`,
				);
				return false;
			}
		}
		const { error } = await service.schema("finance").rpc("mark_dispute_vault_ready", {
			p_dispute_id: disputeId,
		});
		return !error;
	} catch (error) {
		console.error("[disputes:vault]", error instanceof Error ? error.message : error);
		return false;
	}
}

/** `finance.get_dispute_vault` as the caller: the vault, or null when it admits them to none. */
async function readVault(disputeId: string, accessToken: string): Promise<DisputeVaultRead | null> {
	const { data, error } = await getUserClient(accessToken).schema("finance").rpc(
		"get_dispute_vault",
		{
			p_dispute_id: disputeId,
		},
	);
	if (error) throw new Error(`finance.get_dispute_vault failed: ${error.message}`);
	return toDisputeVaultRead(data as Record<string, unknown> | null);
}
// #endregion

/**
 * The tickets among these with a live dispute the viewer can see (PROJECTS EX2): the board's derived
 * Disputed tag (Decision #549 — no ticket status, a tag from the dispute row). RLS admits a case to its
 * parties and the escrow's readers; anyone else, and a failed read, sees no tag rather than a fault.
 */
export async function liveDisputedTicketIds(
	accessToken: string,
	ticketIds: readonly string[],
): Promise<Set<string>> {
	if (ticketIds.length === 0 || !isFinanceBackendLive()) return new Set();
	const { data, error } = await getUserClient(accessToken).schema("finance").from("disputes")
		.select("ticket_id")
		.in("ticket_id", ticketIds as string[])
		.in("status", ["open", "awaiting_response", "under_review"]);
	if (error) return new Set();
	return new Set(
		((data ?? []) as { ticket_id: string | null }[]).flatMap((r) =>
			r.ticket_id ? [r.ticket_id] : []
		),
	);
}

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

	/**
	 * A ticket's dispute state for its reader (PROJECTS EX2): the live case on it, and whether the caller
	 * may raise one now (`finance.ticket_dispute_state`, which mirrors the door's checks). 404 for anyone
	 * who is neither side.
	 */
	static ticketState(
		ticketId: string,
		actor: ReadActor,
	): Promise<ServiceResult<{ state: TicketDisputeState }>> {
		return guarded("ticket-state", async () => {
			const blocked = gate<{ state: TicketDisputeState }>(actor);
			if (blocked) return blocked;
			const { data, error } = await getUserClient(actor.accessToken!).schema("finance").rpc(
				"ticket_dispute_state",
				{ p_ticket_id: ticketId },
			);
			if (error) return refusal(error, "That ticket doesn't exist.");
			const raw = data as Record<string, unknown> | null;
			const state = raw && TicketDisputeStateSchema.safeParse({
				side: raw.side,
				disputeId: raw.dispute_id ?? null,
				status: raw.status ?? null,
				stageId: raw.stage_id ?? null,
				canRaise: raw.can_raise === true,
				window: raw.window ?? null,
			});
			if (!state?.success) return fail(404, { message: "That ticket doesn't exist." });
			return ok({ state: state.data });
		});
	}

	/**
	 * Either side raises a dispute on a ticket's money on one stage (`finance.open_ticket_dispute`): held
	 * money once the work is submitted, or money still clearing after approval, which it freezes. A money
	 * write, so the switch comes first.
	 */
	static open(
		input: OpenTicketDisputeInput,
		actor: ReadActor,
	): Promise<ServiceResult<{ disputeId: string; status: DisputeStatus }>> {
		return guarded("open", async () => {
			const blocked = refuseUnlessMoneyLive<{ disputeId: string; status: DisputeStatus }>(actor);
			if (blocked) return blocked;
			const { data, error } = await getUserClient(actor.accessToken!).schema("finance").rpc(
				"open_ticket_dispute",
				{
					p_ticket_id: input.ticketId,
					p_stage_id: input.stageId,
					p_reason: input.reason,
					p_statement: input.statement,
					p_file_ids: input.fileIds,
				},
			);
			if (error) return refusal(error, "That ticket doesn't exist.");
			const out = data as {
				dispute_id: string;
				status: DisputeStatus;
				vault: { files: VaultFile[] | null } | null;
			};
			if (out.vault) await sealVault(out.dispute_id, out.vault.files ?? []);
			return ok({ disputeId: out.dispute_id, status: out.status }, {
				message: "Dispute raised. The other side has 48 hours to respond or make an offer.",
			});
		});
	}

	/**
	 * A ticket case's Evidence Vault as the caller may see it (PROJECTS EX3): a party reads the manifest
	 * and its hash, an operator the raw snapshot with where its bytes are; 404 for anyone else. An
	 * operator's read finishes a copy the raise left pending.
	 */
	static vault(
		disputeId: string,
		actor: ReadActor,
	): Promise<ServiceResult<{ vault: DisputeVaultRead }>> {
		return guarded("vault", async () => {
			const blocked = gate<{ vault: DisputeVaultRead }>(actor);
			if (blocked) return blocked;
			const vault = await readVault(disputeId, actor.accessToken!);
			if (!vault) return fail(404, { message: "That dispute doesn't exist." });
			if (
				vault.role === "operator" && vault.status === "pending" &&
				await sealVault(disputeId, vaultFilesOf(vault.manifest))
			) {
				return ok({ vault: { ...vault, status: "ready" as const } });
			}
			return ok({ vault });
		});
	}

	/**
	 * The case summary as a PDF (PROJECTS EX3): the case, its timeline, statements, offers, ruling and
	 * the vault's hash, for its parties and operators; 404 for anyone else, exactly as the case read.
	 */
	static async summaryPdf(
		disputeId: string,
		actor: ReadActor,
	): Promise<ServiceResult<RenderedDocument>> {
		const got = await DisputeBackendService.get(disputeId, actor);
		if (!got.ok || !got.data) {
			return fail(got.status, {
				message: got.message,
				details: { code: got.status === 404 ? "not_found" : "unavailable" },
			});
		}
		const dispute = got.data.dispute;
		return guarded("summary-pdf", async () => {
			const vault = dispute.vault ? await readVault(disputeId, actor.accessToken!) : null;
			return ok({
				filename: disputeSummaryFilename(dispute.id),
				bytes: renderPdf(disputeSummaryDocument(dispute, vault)),
			});
		});
	}

	/** Offer the freelancer's share of a ticket case's money (`finance.propose_dispute_offer`). */
	static offer(
		disputeId: string,
		input: DisputeOfferInput,
		actor: ReadActor,
	): Promise<ServiceResult<{ offerId: string }>> {
		return guarded("offer", async () => {
			const blocked = refuseUnlessMoneyLive<{ offerId: string }>(actor);
			if (blocked) return blocked;
			const { data, error } = await getUserClient(actor.accessToken!).schema("finance").rpc(
				"propose_dispute_offer",
				{
					p_dispute_id: disputeId,
					p_payee_share_bp: input.payeeShareBp,
					p_note: input.note ?? null,
				},
			);
			if (error) return refusal(error);
			return ok({ offerId: (data as { offer_id: string }).offer_id }, {
				message: "Offer sent. The other side can accept it to settle the case.",
			});
		});
	}

	/**
	 * Accept the other side's standing offer (`finance.accept_dispute_offer`): the case settles at once on
	 * its terms, through the ticket's money doors.
	 */
	static accept(
		offerId: string,
		actor: ReadActor,
	): Promise<ServiceResult<{ status: DisputeStatus }>> {
		return guarded("accept", async () => {
			const blocked = refuseUnlessMoneyLive<{ status: DisputeStatus }>(actor);
			if (blocked) return blocked;
			const { data, error } = await getUserClient(actor.accessToken!).schema("finance").rpc(
				"accept_dispute_offer",
				{ p_offer_id: offerId },
			);
			if (error) return refusal(error, "That offer doesn't exist.");
			return ok({ status: (data as { status: DisputeStatus }).status }, {
				message: "Settled. The payment moves as agreed.",
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
