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
	WalletActionResult,
	WalletCardHandoff,
	WalletQuery,
	WithdrawInput,
} from "@projective/types/finance";
import { getUserClient } from "../../core/supabase.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";
import { fundableStages, overviewOf } from "./live-wallet.ts";
import { createDepositRule, setIncomeSmoother } from "./live-payments.ts";
import { PaymentBackendService } from "./PaymentBackendService.ts";
import { resolveWalletContext, type WalletAccount, type WalletContext, type WalletRow } from "./wallet-scope.ts";

/**
 * wallet-actions — every `/wallet` money action, as the signed-in caller.
 *
 * The movements that need no external processor move real money through definer functions that
 * authorise the caller themselves (`finance.transfer_funds`, `finance.distribute_vault`,
 * `projects.fund_stage`, `finance.request_spend_approval`); the payout schedule writes through RLS.
 * The processor-backed ones go through the Stripe fiat rails (Decision #126): a top-up answers with a
 * PaymentIntent for the Payment Element (the wallet is credited by the signed webhook, never here), a
 * withdrawal debits the wallet and sends a Stripe Transfer, adding a card answers with a SetupIntent,
 * and a recurring deposit / the Income Smoother are recorded by definer doors. Where the processor is
 * not connected, `PaymentBackendService` answers 503 with the reason.
 *
 * Every success answers with the wallet's refreshed Overview, re-read after the write, so the surface
 * shows what the database now holds rather than an optimistic guess.
 */

/** An action's outcome: the refreshed overview + a note, and for card-backed actions the handoff. */
export type WalletActionOutcome = WalletActionResult & WalletCardHandoff;
type Result = ServiceResult<{ result: WalletActionOutcome }>;

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

/** Re-read the wallet after a write and answer with its fresh Overview (plus any handoff). */
async function after(
	query: WalletQuery,
	actor: ReadActor,
	walletKey: string,
	message: string,
	extra: WalletCardHandoff = {},
	status = 200,
): Promise<Result> {
	const ctx = await resolveWalletContext({ ...query, wallet: walletKey }, actor);
	if (!ctx) return refuse(401, "Sign in to use your wallet.");
	const overview = await overviewOf(ctx);
	return ok({ result: { overview, message, ...extra } }, { message, status }) as Result;
}

/** A fat-service refusal, carried over unchanged. */
function carried(result: ServiceResult<unknown>): Result {
	return fail(result.status, { message: result.message, errors: result.errors }) as Result;
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

/** The owner scope a card or verification is saved for, from a wallet scope. */
function cardScopeOf(scope: string): "personal" | "team" | "business" | null {
	return scope === "personal" || scope === "team" || scope === "business" ? scope : null;
}
// #endregion

// #region Processor-backed (Stripe fiat rails, Decision #126)
/**
 * Top up by card: answers with the PaymentIntent the Payment Element confirms. Nothing is credited
 * here — the overview it returns is the wallet as it stands; the signed `payment_intent.succeeded`
 * webhook credits it, and the surface re-reads the overview once Stripe says the payment went through.
 */
export async function topUp(input: TopUpInput, query: WalletQuery, actor: ReadActor): Promise<Result> {
	const resolved = await contextFor(query, actor, keyOf(input.scope, input.contextId));
	if (isResult(resolved)) return resolved;
	const { account } = resolved;
	const row = rowIn(account, input.currency);
	if (!row) return refuse(409, `This wallet holds no ${input.currency.toUpperCase()}.`);
	const intent = await PaymentBackendService.createTopUpIntent({
		walletId: row.id,
		amountMinor: input.amountMinor,
		currency: row.currency.toUpperCase(),
		idempotencyKey: input.idempotencyKey,
	}, actor);
	if (!intent.ok || !intent.data) return carried(intent);
	return after(query, actor, account.key, "Confirm the payment to add it to this wallet.", {
		payment: intent.data,
	}, intent.status);
}

/** Withdraw to the owner's verified Connect account: the wallet is debited, then a Transfer is sent. */
export async function withdraw(input: WithdrawInput, query: WalletQuery, actor: ReadActor): Promise<Result> {
	const resolved = await contextFor(query, actor, keyOf(input.scope, input.contextId));
	if (isResult(resolved)) return resolved;
	const { account } = resolved;
	const row = rowIn(account, input.currency);
	if (!row) return refuse(409, `This wallet holds no ${input.currency.toUpperCase()}.`);
	const sent = await PaymentBackendService.withdraw({
		walletId: row.id,
		amountMinor: input.amountMinor,
		currency: row.currency.toUpperCase(),
		instant: input.instant,
		idempotencyKey: input.idempotencyKey,
	}, actor);
	if (!sent.ok || !sent.data) return carried(sent);
	const message = sent.data.payout.status === "paid"
		? "Payout sent to your payout account."
		: sent.message ?? "Your payout is on its way.";
	return after(query, actor, account.key, message, { payout: sent.data }, sent.status);
}

/** Create a standing top-up from a saved card, in the wallet's own currency. */
export async function addRecurring(input: DepositRuleInput, query: WalletQuery, actor: ReadActor): Promise<Result> {
	const resolved = await contextFor(query, actor, keyOf(input.scope, input.contextId));
	if (isResult(resolved)) return resolved;
	const { ctx, account } = resolved;
	const row = rowIn(account, input.currency);
	if (!row) return refuse(409, `This wallet holds no ${input.currency.toUpperCase()}.`);
	if (!input.sourceMethodId) {
		return fail(422, {
			message: "Choose a saved card to charge.",
			errors: { sourceMethodId: "Choose a saved card to charge." },
		}) as Result;
	}
	const rule = await createDepositRule(ctx.actor.accessToken, {
		walletId: row.id,
		amountMinor: input.amountMinor,
		currency: row.currency.toUpperCase(),
		interval: input.interval,
		sourceMethodId: input.sourceMethodId,
	});
	if (!rule.ok) {
		return fail(rule.refusal.status, { message: rule.refusal.message, errors: rule.refusal.errors }) as Result;
	}
	return after(query, actor, account.key, "Recurring deposit set up.", {}, 201);
}

/** Save a card: answers with the SetupIntent the Payment Element confirms in `setup` mode. */
export async function addMethod(input: AddMethodInput, query: WalletQuery, actor: ReadActor): Promise<Result> {
	const scope = cardScopeOf(input.scope);
	if (!scope) return refuse(422, "Choose the account the card is for.");
	if (input.methodRole === "payout") {
		return refuse(422, "Payouts go to your payout account — set it up from Verification & payouts.");
	}
	const setup = await PaymentBackendService.createCardSetup({
		scope,
		contextId: scope === "personal" ? null : input.contextId,
	}, actor);
	if (!setup.ok || !setup.data) return carried(setup);
	return after(query, actor, keyOf(input.scope, input.contextId), "Enter the card to save it.", {
		setup: setup.data,
	}, 201);
}

/** Enrol in (or leave) the Income Smoother — the database decides eligibility and the fee. */
export async function enrolSmoother(
	input: IncomeSmootherEnrolInput,
	query: WalletQuery,
	actor: ReadActor,
): Promise<Result> {
	if (!actor.userId || !actor.accessToken) return refuse(401, "Sign in to use your wallet.");
	const set = await setIncomeSmoother(actor.accessToken, {
		currency: input.currency.toUpperCase(),
		targetMonthlyMinor: input.targetMonthlyMinor,
		enrol: input.enrol !== false,
	});
	if (!set.ok) return fail(set.refusal.status, { message: set.refusal.message, errors: set.refusal.errors }) as Result;
	return after(
		query,
		actor,
		"personal",
		set.value.enrolled ? "You're enrolled in the Income Smoother." : "You've left the Income Smoother.",
	);
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
