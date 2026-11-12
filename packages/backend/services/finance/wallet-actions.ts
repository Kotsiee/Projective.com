import type {
	AddMethodInput,
	DepositRuleInput,
	DistributeInput,
	FundEscrowInput,
	IncomeSmootherEnrolInput,
	MovePotInput,
	PayoutScheduleInput,
	RecurringRuleAction,
	SavePotInput,
	SpendDecisionInput,
	SpendRequestInput,
	TopUpInput,
	TransferInput,
	WalletActionRequest,
	WalletActionResult,
	WalletCardHandoff,
	WalletLockCode,
	WalletQuery,
	WithdrawInput,
} from "@projective/types/finance";
import { AGE_RESTRICTED, isAgeRestricted } from "../../core/age-gate.ts";
import { businessAuthorityRefusal } from "../../core/business-authority.ts";
import { businessNotActiveRefusal } from "../../core/business-lifecycle.ts";
import { spendGateRefusal } from "../../core/spend-gate.ts";
import { getUserClient } from "../../core/supabase.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";
import { formatMoney, unpricedTicketsSentence } from "@projective/types/finance";
import { LOCK_REASON, overviewOf } from "./live-wallet.ts";
import { readStageFundingQuote } from "./stage-funding.ts";
import { createDepositRule, refusalOf, setIncomeSmoother } from "./live-payments.ts";
import { PaymentBackendService } from "./PaymentBackendService.ts";
import { resolveWalletContext, type WalletAccount, type WalletContext, type WalletRow } from "./wallet-scope.ts";

/**
 * wallet-actions — every `/wallet` money action, as the signed-in caller.
 *
 * The movements that need no external processor move real money through definer functions that
 * authorise the caller themselves (`finance.transfer_funds`, `finance.distribute_vault`,
 * `projects.fund_stage`, `finance.request_spend_approval`, `finance.save_payout_schedule`).
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
		case "PM403":
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
	if (isAgeRestricted(error)) return AGE_RESTRICTED.message;
	if (error.code === "23514" && /balance_cents/.test(error.message)) {
		return "That wallet doesn't hold enough for this.";
	}
	// `earmarked: …` (finance.fn_wallet_debit): the spend would reach money set aside in pots.
	const earmarked = /^earmarked:\s*([\s\S]+)$/.exec(error.message.trim());
	if (error.code === "PF402" && earmarked) {
		return `${earmarked[1].replace(/\s+/g, " ").trim()}.`.slice(0, 200);
	}
	return error.message.replace(/\s+/g, " ").trim().slice(0, 200) || "That didn't go through.";
}

function refuse(status: number, message: string): Result {
	return fail(status, { message }) as Result;
}

/**
 * A money RPC's refusal: the business spend gate's (`kyb_required` / `over_limit` / `needs_approval` —
 * a 403 whose details name the spend an approval request would bind to), a draft or archived
 * business's (`business_not_active` — a 409 the business refusal map words; an archived business
 * takes no money in, Decision #248 (k)) or the function's own.
 */
function moneyRefusal(error: { code?: string; message: string; details?: string | null }): Result {
	const gate = spendGateRefusal(error);
	if (gate) return fail(gate.status, { message: gate.message, details: gate.details }) as Result;
	const inactive = businessNotActiveRefusal(error);
	if (inactive) {
		return fail(inactive.status, { message: inactive.message, details: inactive.details }) as Result;
	}
	return refuse(statusFor(error.code), messageFor(error));
}

/**
 * A refusal from a governance RPC that raises `<field>: <reason>` (`finance.request_spend_approval`):
 * `22023` is a validation refusal keyed to its field, `42501` authority, `P0002` a missing wallet, and
 * a draft or archived business's `business_not_active` the 409 the business refusal map words.
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
		case "PC409":
			return fail(409, {
				message: reason,
				errors: match && match[1] !== "auth" ? { [match[1]]: reason } : undefined,
			}) as Result;
		default:
			return moneyRefusal(error);
	}
}

/**
 * The wallet `key` for a scope + id, as the read query names it; `null` for a vault scope with no id,
 * which names no wallet and is never read as the personal one.
 */
function keyOf(scope: string, id: string): string | null {
	if (scope === "personal" || scope === "aggregate") return scope;
	return id ? `${scope}:${id}` : null;
}

/** An automation control refused because its engine does not run yet (Decision #337, ruling M6). */
function locked(code: WalletLockCode): Result {
	return fail(409, { message: LOCK_REASON[code], details: { reason: code } }) as Result;
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

/** A fat-service refusal, carried over unchanged — its `details` too, so a typed refusal stays typed. */
function carried(result: ServiceResult<unknown>): Result {
	return fail(result.status, {
		message: result.message,
		errors: result.errors,
		details: result.details,
	}) as Result;
}

/**
 * The account an action runs on, or its refusal. A money action never falls back: a wallet the
 * viewer cannot open (the read resolved another, Audit R5) is refused before any door is called.
 */
export function actionTarget(
	ctx: WalletContext,
): { ctx: WalletContext; account: WalletAccount } | Result {
	if (ctx.requested !== ctx.resolved) return refuse(403, "That wallet isn't available to you.");
	if (ctx.target === "aggregate") {
		return refuse(422, "Choose a wallet — the combined view is read-only.");
	}
	return { ctx, account: ctx.target };
}

/** Guard + resolve the wallet an action targets. */
async function contextFor(
	query: WalletQuery,
	actor: ReadActor,
	walletKey: string | null,
): Promise<{ ctx: WalletContext; account: WalletAccount } | Result> {
	if (walletKey === null) return refuse(422, "Choose a wallet.");
	const ctx = await resolveWalletContext({ ...query, wallet: walletKey }, actor);
	if (!ctx) return refuse(401, "Sign in to use your wallet.");
	return actionTarget(ctx);
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

/**
 * Withdraw to the owner's verified Connect account: the wallet is debited, then a Transfer is sent. A
 * chosen destination is validated and recorded by the database (Decision #202).
 */
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
		destinationMethodId: input.destinationId,
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
		return fail(rule.refusal.status, {
			message: rule.refusal.message,
			errors: rule.refusal.errors,
			details: rule.refusal.details,
		}) as Result;
	}
	return after(query, actor, account.key, "Recurring deposit set up.", {}, 201);
}

/** Save a card: answers with the SetupIntent the Payment Element confirms in `setup` mode. */
export async function addMethod(input: AddMethodInput, query: WalletQuery, actor: ReadActor): Promise<Result> {
	const scope = cardScopeOf(input.scope);
	const key = keyOf(input.scope, input.contextId);
	if (!scope || !key) return refuse(422, "Choose the account the card is for.");
	if (input.methodRole === "payout") {
		return refuse(422, "Payouts go to your payout account — set it up from Verification & payouts.");
	}
	const setup = await PaymentBackendService.createCardSetup({
		scope,
		contextId: scope === "personal" ? null : input.contextId,
	}, actor);
	if (!setup.ok || !setup.data) return carried(setup);
	return after(query, actor, key, "Enter the card to save it.", {
		setup: setup.data,
	}, 201);
}

/**
 * Enrol in (or leave) the Income Smoother — the database decides eligibility and the fee. Enrolment
 * is locked while the smoother is Planned (Decision #337, ruling M6); leaving never is.
 */
export async function enrolSmoother(
	input: IncomeSmootherEnrolInput,
	query: WalletQuery,
	actor: ReadActor,
): Promise<Result> {
	if (input.enrol !== false) return locked("smoother_planned");
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
	if (error) return moneyRefusal(error);
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
 * Fund a stage's escrow from this wallet — a business vault for its client projects, or a person's own
 * wallet for the projects they own with no client business (Decision #197). The database re-quotes the
 * stage (`projects.get_stage_funding_quote`) and it must still cost what the buyer was shown, so a
 * ticket added or re-priced between the page and the press refuses rather than committing a figure
 * nobody confirmed. Tickets nobody has claimed are held prepaid and bound to whoever claims them.
 */
export async function fundEscrow(input: FundEscrowInput, query: WalletQuery, actor: ReadActor): Promise<Result> {
	const resolved = await contextFor(query, actor, keyOf(input.scope, input.contextId));
	if (isResult(resolved)) return resolved;
	const { ctx, account } = resolved;
	if (account.scope !== "business" && account.scope !== "personal") {
		return refuse(422, "A stage is funded from a business wallet or your own.");
	}

	const db = getUserClient(ctx.actor.accessToken).schema("projects");
	const { data: stageRow, error: readError } = await db.from("project_stages")
		.select("project_id").eq("id", input.stageId).maybeSingle();
	if (readError) throw new Error(`projects.project_stages read failed: ${readError.message}`);
	if (!stageRow) return refuse(404, "That stage no longer exists.");
	const projectId = (stageRow as { project_id: string }).project_id;

	const quoted = await readStageFundingQuote(ctx.actor.accessToken, projectId, input.stageId);
	if (!quoted.ok) {
		return fail(quoted.refusal.status, {
			message: quoted.refusal.message,
			details: quoted.refusal.details,
		}) as Result;
	}
	const quote = quoted.value;
	const payerId = account.scope === "business" ? account.id : ctx.viewer.userId;
	if (quote.payer.scope !== account.scope || quote.payer.id !== payerId) {
		return refuse(409, "This stage is paid for from another wallet.");
	}
	if (quote.unpricedCount > 0) return refuse(409, unpricedTicketsSentence(quote.unpricedCount));
	if (quote.amountMinor !== input.amountMinor || quote.currency !== input.currency.toUpperCase()) {
		return refuse(
			409,
			`This stage's funding changed — it's now ${
				formatMoney(quote.amountMinor, quote.currency)
			}. Review it and try again.`,
		);
	}

	const { data, error } = await db.rpc("fund_stage", {
		p_project_id: projectId,
		p_stage_id: input.stageId,
	});
	if (error) {
		// Only a holder of vault `spend` on the paying business's wallet funds its escrow (BB2).
		const authority = businessAuthorityRefusal(error);
		if (authority) {
			return fail(authority.status, {
				message: authority.message,
				details: authority.details,
			}) as Result;
		}
		return moneyRefusal(error);
	}
	const waiting =
		Number((data as { awaiting_claim_count?: number | string } | null)?.awaiting_claim_count) || 0;
	const note = waiting === 0
		? ""
		: ` ${
			waiting === 1
				? "One ticket nobody has claimed is"
				: `${waiting} tickets nobody has claimed are`
		} held for whoever claims ${waiting === 1 ? "it" : "them"}.`;
	return after(query, actor, account.key, `Escrow funded for ${quote.stageName}.${note}`);
}
// #endregion

// #region Settings
/**
 * The `finance.save_payout_schedule` arguments a save sends, or its refusal: the schedule of the
 * currency the action names (FCA N17); with none named, the wallet's only currency. A wallet holding
 * several is never guessed at: the save is refused until the action names one.
 */
export function payoutScheduleArgs(account: WalletAccount, input: PayoutScheduleInput) {
	if (!input.currency && account.rows.length > 1) {
		const message =
			"This account holds more than one currency. Choose which one these payouts are for.";
		return fail(422, { message, errors: { currency: message } }) as Result;
	}
	const row = input.currency ? rowIn(account, input.currency) : account.rows[0];
	if (!row) {
		return refuse(
			409,
			input.currency
				? `This account holds no ${input.currency.toUpperCase()}.`
				: "This account has no wallet yet.",
		);
	}
	return {
		p_owner_type: row.owner_type,
		p_owner_id: row.owner_id,
		p_currency: row.currency.toUpperCase(),
		p_mode: input.mode,
		p_threshold_cents: input.mode === "threshold" ? input.thresholdMinor : null,
		p_destination_method_id: input.destinationId,
		p_instant: input.instant,
	};
}

/**
 * A refusal from `finance.save_payout_schedule`: Instant Payouts are Planned (`instant_payout_planned`,
 * Decision #337, ruling P3, a 409 naming its reason); otherwise the door's `<field>: <reason>`.
 */
export function payoutScheduleRefusal(error: { code?: string; message: string }): Result {
	if (error.message.trim().startsWith("instant_payout_planned")) {
		return fail(409, {
			message: "Instant payouts are planned and not available yet.",
			details: { reason: "instant_payout_planned" },
		}) as Result;
	}
	if (error.code === "42501" && /^auth:\s*only a member/.test(error.message.trim())) {
		return refuse(403, "Only a member who may withdraw can change payouts.");
	}
	if (error.code === "PA403") return governedRefusal({ ...error, code: "22023" });
	return governedRefusal(error);
}

/** The sentence a saved schedule answers with. */
function savedSentence(mode: PayoutScheduleInput["mode"]): string {
	switch (mode) {
		case "scheduled_weekly":
			return "Payouts now run every Monday.";
		case "scheduled_monthly":
			return "Payouts now run on the 1st of each month.";
		case "threshold":
			return "Payouts now run whenever your available balance reaches the threshold.";
		default:
			return "Payouts are manual.";
	}
}

/**
 * Set the wallet's payout schedule through `finance.save_payout_schedule`, which takes a withdrawal's
 * authority (the owner, or `withdraw` on that currency's vault), checks the destination and the
 * threshold, and makes the caller the author every run withdraws as (Decision #337, ruling M6).
 */
export async function setPayout(input: PayoutScheduleInput, query: WalletQuery, actor: ReadActor): Promise<Result> {
	const resolved = await contextFor(query, actor, keyOf(input.scope, input.contextId));
	if (isResult(resolved)) return resolved;
	const { ctx, account } = resolved;
	const args = payoutScheduleArgs(account, input);
	if (isResult(args)) return args;

	const { error } = await getUserClient(ctx.actor.accessToken).schema("finance")
		.rpc("save_payout_schedule", args);
	if (error) return payoutScheduleRefusal(error);
	return after(query, actor, account.key, savedSentence(input.mode));
}

/**
 * Ask for approval of a spend the caller's envelope does not cover, through
 * `finance.request_spend_approval`: the database checks the wallet is a business's (a team has nobody
 * to approve), the caller may spend from it, the ref names something this business pays for and has no
 * request already open, and that the spend genuinely needs approval (over the per-transaction ceiling,
 * over the remaining cap, or at/above the threshold); it sets the currency and the expiry itself. The
 * approval is bound to `refTable`/`refId` and is spent only by a charge for that same ref.
 */
export async function requestSpend(input: SpendRequestInput, query: WalletQuery, actor: ReadActor): Promise<Result> {
	const resolved = await contextFor(query, actor, keyOf(input.scope, input.contextId));
	if (isResult(resolved)) return resolved;
	const { ctx, account } = resolved;
	if (account.scope !== "business") return refuse(422, "Spend requests are for business accounts.");
	const row = rowIn(account, input.currency);
	if (!row) return refuse(409, `This account holds no ${input.currency.toUpperCase()}.`);

	const filed = await fileSpendRequest(ctx.actor.accessToken, {
		walletId: row.id,
		amountMinor: input.amountMinor,
		reason: input.reason,
		refTable: input.refTable,
		refId: input.refId,
	});
	if (!filed.ok) return filed as unknown as Result;
	return after(query, actor, account.key, "Request sent for approval.");
}

/** What {@link fileSpendRequest} files: the wallet, the amount in its currency, and what it is for. */
export interface SpendRequestFiling {
	walletId: string;
	amountMinor: number;
	reason: string;
	refTable: SpendRequestInput["refTable"];
	refId: string;
}

/**
 * File a spend approval request through `finance.request_spend_approval`, as the caller — the ONE door
 * both `/wallet` ({@link requestSpend}) and the checkout (`CheckoutBackendService.requestApproval`,
 * Decision #243) file through, so a request is refused the same way wherever it is asked for: `22023`
 * keyed to its field (`reason`, `amountMinor` "needs no approval", `refId`), `42501` authority,
 * `P0002` a wallet that is not a business's, `PC409` a request for the same ref already waiting.
 */
export async function fileSpendRequest(
	accessToken: string,
	filing: SpendRequestFiling,
): Promise<ServiceResult<{ id: string | null }>> {
	const { data, error } = await getUserClient(accessToken).schema("finance").rpc(
		"request_spend_approval",
		{
			p_wallet: filing.walletId,
			p_amount: filing.amountMinor,
			p_reason: filing.reason,
			p_ref_table: filing.refTable,
			p_ref_id: filing.refId,
		},
	);
	if (error) return governedRefusal(error) as unknown as ServiceResult<{ id: string | null }>;
	const id = (data as { id?: unknown } | null)?.id;
	return ok({ id: typeof id === "string" ? id : null });
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

// #region Recurring rules
/** A recurring-rule action, as `POST /api/wallet/action` carries it. */
export type RecurringRuleRequest = Extract<WalletActionRequest, { action: RecurringRuleAction }>;

/**
 * The change each recurring-rule action asks `finance.update_deposit_rule` for, and what it says once
 * made. A resume or a new amount is the caller's consent to the charge: the door makes them the rule's
 * author (`created_by`), so the card is then charged on their authority, and the message says so.
 */
export function recurringChange(input: RecurringRuleRequest): {
	args: { p_active?: boolean; p_amount_cents?: number; p_archive?: boolean };
	message: string;
} {
	switch (input.action) {
		case "pause_recurring":
			return { args: { p_active: false }, message: "Recurring deposit paused." };
		case "resume_recurring":
			return {
				args: { p_active: true },
				message: "Recurring deposit resumed. It now charges the card on your authority.",
			};
		case "edit_recurring":
			return {
				args: { p_amount_cents: input.amountMinor },
				message: "Amount changed. The deposit now charges the card on your authority.",
			};
		case "archive_recurring":
			return { args: { p_archive: true }, message: "Recurring deposit removed." };
	}
}

/**
 * Pause, resume, re-price or remove one recurring deposit through `finance.update_deposit_rule`, the
 * only door that changes a rule (FCA A13): it takes the owner of a personal wallet or an `add_funds`
 * holder on a vault, and re-checks the card before a change that can lead to a charge. The rule must be
 * on the wallet the action names, and a new amount must be in the rule's own currency.
 */
export async function changeRecurring(
	input: RecurringRuleRequest,
	query: WalletQuery,
	actor: ReadActor,
): Promise<Result> {
	const resolved = await contextFor(query, actor, keyOf(input.scope, input.contextId));
	if (isResult(resolved)) return resolved;
	const { ctx, account } = resolved;
	const db = getUserClient(ctx.actor.accessToken).schema("finance");
	const { data, error: readError } = await db.from("deposit_rules")
		.select("wallet_id, currency").eq("id", input.ruleId).maybeSingle();
	if (readError) throw new Error(`finance.deposit_rules read failed: ${readError.message}`);
	const rule = data as { wallet_id: string; currency: string } | null;
	if (!rule || !account.rows.some((row) => row.id === rule.wallet_id)) {
		return refuse(404, "That recurring deposit isn't on this wallet.");
	}
	const held = rule.currency.toUpperCase();
	if (input.action === "edit_recurring" && input.currency.toUpperCase() !== held) {
		return refuse(409, `This deposit is in ${held}. Enter the amount in ${held}.`);
	}

	const change = recurringChange(input);
	const { error } = await db.rpc("update_deposit_rule", { p_rule: input.ruleId, ...change.args });
	if (error) {
		const refusal = refusalOf(error, "update_deposit_rule");
		return fail(refusal.status, {
			message: refusal.message,
			errors: refusal.errors,
			details: refusal.details,
		}) as Result;
	}
	return after(query, actor, account.key, change.message);
}
// #endregion
// #region Pots
/** The request fields a pot door names in its `<field>: <reason>` refusals. */
const POT_FIELDS: ReadonlySet<string> = new Set([
	"potId",
	"purpose",
	"name",
	"autoAllocateBp",
	"goalMinor",
	"amountMinor",
	"direction",
]);

/** A pot door's refusal, its field named where the door named one. */
function potRefusal(
	error: { code?: string; message: string; details?: string | null },
	label: string,
): Result {
	const refusal = refusalOf(error, label);
	const field = /^([A-Za-z]+):/.exec(error.message.trim())?.[1];
	const errors = refusal.errors ??
		(field && POT_FIELDS.has(field) ? { [field]: refusal.message } : undefined);
	return fail(refusal.status, {
		message: refusal.message,
		errors,
		details: refusal.details,
	}) as Result;
}

/**
 * The `finance.save_wallet_pot` arguments for a save on the wallet `walletId`: a null share keeps
 * the pot's own (a new tax pot takes the platform's suggested default), a null goal clears it.
 */
export function savePotArgs(input: SavePotInput, walletId: string): {
	p_wallet: string;
	p_id: string | null;
	p_purpose: SavePotInput["purpose"];
	p_name: string;
	p_auto_allocate_bp: number | null;
	p_goal_cents: number | null;
	p_archive: boolean;
} {
	return {
		p_wallet: walletId,
		p_id: input.potId,
		p_purpose: input.purpose,
		p_name: input.name,
		p_auto_allocate_bp: input.autoAllocateBp,
		p_goal_cents: input.goalMinor,
		p_archive: input.archive === true,
	};
}

/**
 * Save one of the wallet's pots through `finance.save_wallet_pot`, the only door that writes one:
 * it takes the owner of a personal wallet or a `distribute` holder on a vault, and keeps the
 * wallet's pots at most 100% of income. The pot is saved on the account's wallet in `currency`.
 */
export async function savePot(
	input: SavePotInput,
	query: WalletQuery,
	actor: ReadActor,
): Promise<Result> {
	const resolved = await contextFor(query, actor, keyOf(input.scope, input.contextId));
	if (isResult(resolved)) return resolved;
	const { ctx, account } = resolved;
	const row = rowIn(account, input.currency);
	if (!row) return refuse(404, `This wallet holds no ${input.currency.toUpperCase()}.`);
	const { error } = await getUserClient(ctx.actor.accessToken).schema("finance")
		.rpc("save_wallet_pot", savePotArgs(input, row.id));
	if (error) return potRefusal(error, "save_wallet_pot");
	const message = input.archive === true
		? "Pot archived."
		: input.potId
		? "Pot saved."
		: "Pot created.";
	return after(query, actor, account.key, message);
}

/**
 * Earmark Available money into a pot, or release it, through `finance.move_pot_funds` (same
 * authority as a save). The pot must be on the wallet the action names, and the amount in the pot's
 * own currency.
 */
export async function movePot(
	input: MovePotInput,
	query: WalletQuery,
	actor: ReadActor,
): Promise<Result> {
	const resolved = await contextFor(query, actor, keyOf(input.scope, input.contextId));
	if (isResult(resolved)) return resolved;
	const { ctx, account } = resolved;
	const db = getUserClient(ctx.actor.accessToken).schema("finance");
	const { data, error: readError } = await db.from("wallet_pots")
		.select("wallet_id, currency").eq("id", input.potId).maybeSingle();
	if (readError) throw new Error(`finance.wallet_pots read failed: ${readError.message}`);
	const pot = data as { wallet_id: string; currency: string } | null;
	if (!pot || !account.rows.some((row) => row.id === pot.wallet_id)) {
		return refuse(404, "That pot isn't on this wallet.");
	}
	const held = pot.currency.toUpperCase();
	if (input.currency.toUpperCase() !== held) {
		return refuse(409, `This pot is in ${held}. Enter the amount in ${held}.`);
	}
	const { error } = await db.rpc("move_pot_funds", {
		p_pot: input.potId,
		p_amount: input.amountMinor,
		p_direction: input.direction,
	});
	if (error) return potRefusal(error, "move_pot_funds");
	return after(
		query,
		actor,
		account.key,
		input.direction === "in" ? "Money set aside in the pot." : "Money moved back to Available.",
	);
}
// #endregion