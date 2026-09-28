import type {
	AddMethodInput,
	DepositRuleInput,
	DistributeInput,
	FundEscrowInput,
	IncomeSmootherEnrolInput,
	PayoutScheduleInput,
	SpendDecisionInput,
	SpendRequestInput,
	TopUpInput,
	TransferInput,
	WalletAction,
	WalletActionResult,
	WalletQuery,
	WithdrawInput,
} from "@projective/types/finance";
import { getUserClient } from "../../core/supabase.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";
import { fundableStages, overviewOf, PROCESSOR_REASON } from "./live-wallet.ts";
import { resolveWalletContext, type WalletAccount, type WalletContext, type WalletRow } from "./wallet-scope.ts";

/**
 * wallet-actions — every `/wallet` money action, as the signed-in caller.
 *
 * The movements that need no external processor move real money through definer functions that
 * authorise the caller themselves (`finance.transfer_funds`, `finance.distribute_vault`,
 * `projects.fund_stage`, `finance.request_spend_approval`); the payout schedule writes through RLS; and
 * the ones that need a payment or payout processor — top-up, withdrawal, recurring deposit, adding a
 * method, the Income Smoother — are refused with the reason, because recording money that did not
 * move would be worse than not offering it.
 *
 * Every success answers with the wallet's refreshed Overview, re-read after the write, so the surface
 * shows what the database now holds rather than an optimistic guess.
 */

type Result = ServiceResult<{ result: WalletActionResult }>;

// #region Plumbing
/** HTTP status for a refusal SQLSTATE from the wallet functions. */
function statusFor(code: string | undefined): number {
	switch (code) {
		case "42501":
		case "PK403":
		case "PA403":
			return 403;
		case "PB404":
			return 404;
		case "PX409":
		case "PC409":
		case "P0001":
			return 409;
		case "PF402":
		case "23514":
			return 402;
		default:
			return 422;
	}
}

/** A refusal's sentence: the function's own, except where Postgres would speak in constraint names. */
function messageFor(error: { code?: string; message: string }): string {
	if (error.code === "23514" && /balance_cents/.test(error.message)) {
		return "That wallet doesn't hold enough for this.";
	}
	return error.message.replace(/\s+/g, " ").trim().slice(0, 200) || "That didn't go through.";
}

function refuse(status: number, message: string): Result {
	return fail(status, { message }) as Result;
}

/**
 * A refusal from a governance RPC that raises `<field>: <reason>` (`finance.request_spend_approval`):
 * `22023` is a validation refusal keyed to its field, `42501` authority, `P0002` a missing wallet.
 * Anything else is not a sentence for a reader and is answered generically.
 */
function governedRefusal(error: { code?: string; message: string }): Result {
	const match = /^([A-Za-z_]+):\s*([\s\S]+)$/.exec(error.message.trim());
	const raw = (match ? match[2] : error.message).replace(/\s+/g, " ").trim();
	const reason = raw ? `${raw[0].toUpperCase()}${raw.slice(1)}${/[.!?]$/.test(raw) ? "" : "."}` : raw;
	switch (error.code) {
		case "22023":
			return fail(422, {
				message: reason,
				errors: match && match[1] !== "auth" ? { [match[1]]: reason } : undefined,
			}) as Result;
		case "42501":
			return refuse(match?.[1] === "auth" ? 401 : 403, reason || "You can't request a spend here.");
		case "P0002":
			return refuse(404, "That wallet doesn't exist.");
		default:
			return refuse(statusFor(error.code), messageFor(error));
	}
}

/** The wallet `key` for a scope + id, as the read query names it. */
function keyOf(scope: string, id: string): string {
	return scope === "personal" || !id ? "personal" : `${scope}:${id}`;
}

function accountOf(ctx: WalletContext, scope: string, id: string): WalletAccount | null {
	return ctx.accounts.find((a) => a.key === keyOf(scope, id)) ?? null;
}

function rowIn(account: WalletAccount, currency: string): WalletRow | null {
	return account.rows.find((row) => row.currency.toUpperCase() === currency.toUpperCase()) ?? null;
}

/** Re-read the wallet after a write and answer with its fresh Overview. */
async function after(
	query: WalletQuery,
	actor: ReadActor,
	walletKey: string,
	message: string,
): Promise<Result> {
	const ctx = await resolveWalletContext({ ...query, wallet: walletKey }, actor);
	if (!ctx) return refuse(401, "Sign in to use your wallet.");
	const overview = await overviewOf(ctx);
	return ok({ result: { overview, message } }, { message }) as Result;
}

/** Guard + resolve the wallet an action targets. */
async function contextFor(
	query: WalletQuery,
	actor: ReadActor,
	walletKey: string,
): Promise<{ ctx: WalletContext; account: WalletAccount } | Result> {
	const ctx = await resolveWalletContext({ ...query, wallet: walletKey }, actor);
	if (!ctx) return refuse(401, "Sign in to use your wallet.");
	if (ctx.target === "aggregate") return refuse(422, "Choose a wallet — the combined view is read-only.");
	return { ctx, account: ctx.target };
}

function isResult(value: unknown): value is Result {
	return typeof value === "object" && value !== null && "ok" in value;
}

/** A processor-backed action: refused with its reason, whoever asks. */
function needsProcessor(action: WalletAction): Result {
	return refuse(501, PROCESSOR_REASON[action] ?? "That needs a payment processor, which isn't connected here.");
}
// #endregion

// #region Processor-backed (refused here)
export function topUp(_input: TopUpInput): Result {
	return needsProcessor("top_up");
}

export function withdraw(_input: WithdrawInput): Result {
	return needsProcessor("withdraw");
}

export function addRecurring(_input: DepositRuleInput): Result {
	return needsProcessor("new_recurring");
}

export function addMethod(_input: AddMethodInput): Result {
	return needsProcessor("add_method");
}

export function enrolSmoother(_input: IncomeSmootherEnrolInput): Result {
	return needsProcessor("enrol_smoother");
}
// #endregion

// #region Movements
/** Move money between two of the caller's own wallets, in the source wallet's currency. */
export async function transfer(input: TransferInput, query: WalletQuery, actor: ReadActor): Promise<Result> {
	if (input.fromScope === "aggregate" || input.toScope === "aggregate") {
		return refuse(422, "Choose the wallets to move money between.");
	}
	const resolved = await contextFor(query, actor, keyOf(input.fromScope, input.fromId));
	if (isResult(resolved)) return resolved;
	const { ctx, account: from } = resolved;
	const to = accountOf(ctx, input.toScope, input.toId);
	if (!to) return refuse(404, "That wallet isn't one of yours.");
	const fromRow = rowIn(from, input.currency);
	if (!fromRow) return refuse(409, `This wallet holds no ${input.currency.toUpperCase()}.`);
	const toRow = rowIn(to, input.currency);
	if (!toRow) {
		return refuse(409, `${to.owner.name} has no ${input.currency.toUpperCase()} wallet to receive this.`);
	}

	const { error } = await getUserClient(ctx.actor.accessToken).schema("finance").rpc("transfer_funds", {
		p_from_wallet: fromRow.id,
		p_to_wallet: toRow.id,
		p_amount: input.amountMinor,
		p_note: input.note,
		p_idempotency_key: input.idempotencyKey,
	});
	if (error) return refuse(statusFor(error.code), messageFor(error));
	return after(query, actor, from.key, `Moved to ${to.owner.name}.`);
}

/** Pay part of a team vault out to its members by their agreed stakes. */
export async function distribute(input: DistributeInput, query: WalletQuery, actor: ReadActor): Promise<Result> {
	const resolved = await contextFor(query, actor, keyOf(input.scope, input.contextId));
	if (isResult(resolved)) return resolved;
	const { ctx, account } = resolved;
	if (account.scope !== "team") return refuse(422, "Only a team vault distributes to its members.");
	const row = rowIn(account, input.currency);
	if (!row) return refuse(409, `This vault holds no ${input.currency.toUpperCase()}.`);

	const { data, error } = await getUserClient(ctx.actor.accessToken).schema("finance").rpc("distribute_vault", {
		p_wallet: row.id,
		p_amount: input.amountMinor,
		p_idempotency_key: input.idempotencyKey,
	});
	if (error) return refuse(statusFor(error.code), messageFor(error));
	const shares = Array.isArray((data as { shares?: unknown[] } | null)?.shares)
		? (data as { shares: unknown[] }).shares.length
		: 0;
	return after(query, actor, account.key, `Distributed to ${shares} ${shares === 1 ? "member" : "members"}.`);
}

/**
 * Fund an assigned stage's escrow. The stage's requirement is recomputed and must equal what the
 * buyer was shown, so a ticket added or re-priced between the page and the press refuses rather than
 * committing a figure nobody confirmed.
 */
export async function fundEscrow(input: FundEscrowInput, query: WalletQuery, actor: ReadActor): Promise<Result> {
	const resolved = await contextFor(query, actor, keyOf(input.scope, input.contextId));
	if (isResult(resolved)) return resolved;
	const { ctx, account } = resolved;
	if (account.scope !== "business") return refuse(422, "Escrow is funded from a business wallet.");

	const stage = (await fundableStages(ctx, account)).find((s) => s.stageId === input.stageId);
	if (!stage) return refuse(409, "That stage isn't waiting for its escrow any more.");
	const shown = stage.amount.origin ?? stage.amount;
	if (shown.minor !== input.amountMinor || shown.currency.toUpperCase() !== input.currency.toUpperCase()) {
		return refuse(409, `This stage's funding changed — it's now ${stage.amount.display}. Review it and try again.`);
	}

	const db = getUserClient(ctx.actor.accessToken).schema("projects");
	const { data: stageRow, error: readError } = await db.from("project_stages")
		.select("project_id").eq("id", stage.stageId).maybeSingle();
	if (readError) throw new Error(`projects.project_stages read failed: ${readError.message}`);
	if (!stageRow) return refuse(404, "That stage no longer exists.");

	const { error } = await db.rpc("fund_stage", {
		p_project_id: (stageRow as { project_id: string }).project_id,
		p_stage_id: stage.stageId,
	});
	if (error) return refuse(statusFor(error.code), messageFor(error));
	return after(query, actor, account.key, `Escrow funded for ${stage.stageName}.`);
}
// #endregion

// #region Settings
/**
 * Set the wallet's payout schedule. Saved through RLS (`Manage own payout schedule` — the withdraw
 * capability); it applies once payouts run, which the Payouts page states.
 */
export async function setPayout(input: PayoutScheduleInput, query: WalletQuery, actor: ReadActor): Promise<Result> {
	const resolved = await contextFor(query, actor, keyOf(input.scope, input.contextId));
	if (isResult(resolved)) return resolved;
	const { ctx, account } = resolved;
	const row = account.rows[0];
	if (!row) return refuse(409, "This account has no wallet yet.");
	if (input.mode === "threshold" && !input.thresholdMinor) {
		return refuse(422, "A threshold schedule needs an amount.");
	}

	const { error } = await getUserClient(ctx.actor.accessToken).schema("finance").from("payout_schedules").upsert({
		owner_type: row.owner_type,
		owner_id: row.owner_id,
		currency: row.currency,
		mode: input.mode,
		threshold_cents: input.mode === "threshold" ? input.thresholdMinor : null,
		destination_method_id: input.destinationId,
		instant: input.instant,
		active: true,
	}, { onConflict: "owner_type,owner_id,currency" });
	if (error) {
		return refuse(
			error.code === "42501" ? 403 : 422,
			error.code === "42501" ? "Only a member who may withdraw can change payouts." : messageFor(error),
		);
	}
	return after(query, actor, account.key, "Payout schedule saved.");
}

/**
 * Ask for approval of a spend the caller's envelope does not cover, through
 * `finance.request_spend_approval`: the database checks the caller may spend from the wallet at all and
 * that the spend genuinely needs approval (over the per-transaction ceiling, over the remaining cap, or
 * at/above the threshold), and sets the currency and the expiry itself.
 */
export async function requestSpend(input: SpendRequestInput, query: WalletQuery, actor: ReadActor): Promise<Result> {
	const resolved = await contextFor(query, actor, keyOf(input.scope, input.contextId));
	if (isResult(resolved)) return resolved;
	const { ctx, account } = resolved;
	if (account.scope === "personal") return refuse(422, "Spend requests are for shared accounts.");
	const row = rowIn(account, input.currency);
	if (!row) return refuse(409, `This account holds no ${input.currency.toUpperCase()}.`);

	const { error } = await getUserClient(ctx.actor.accessToken).schema("finance").rpc("request_spend_approval", {
		p_wallet: row.id,
		p_amount: input.amountMinor,
		p_reason: input.reason,
		p_ref_table: null,
		p_ref_id: null,
	});
	if (error) return governedRefusal(error);
	return after(query, actor, account.key, "Request sent for approval.");
}

/** Approve or reject a queued spend (an admin who is not the requester). */
export async function decideSpend(input: SpendDecisionInput, query: WalletQuery, actor: ReadActor): Promise<Result> {
	const resolved = await contextFor(query, actor, keyOf(input.scope, input.contextId));
	if (isResult(resolved)) return resolved;
	const { ctx, account } = resolved;

	const { data, error } = await getUserClient(ctx.actor.accessToken).schema("finance").rpc("decide_spend_approval", {
		p_approval: input.approvalId,
		p_decision: input.decision,
	});
	if (error) return refuse(statusFor(error.code), messageFor(error));
	const status = (data as { status?: string } | null)?.status;
	return after(
		query,
		actor,
		account.key,
		status === "expired" ? "That request had expired." : input.decision === "approve" ? "Request approved." : "Request declined.",
	);
}
// #endregion
