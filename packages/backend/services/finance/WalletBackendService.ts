import type {
	AccessView,
	ActivityRange,
	ActivityView,
	AddMethodInput,
	DepositRuleInput,
	DistributeInput,
	FundEscrowInput,
	FundingView,
	IncomeSmootherEnrolInput,
	InvoicesView,
	MethodsView,
	PayoutScheduleInput,
	PayoutsView,
	SpendDecisionInput,
	SpendRequestInput,
	TopUpInput,
	TransactionListParams,
	TransactionPage,
	TransferInput,
	WalletActionResult,
	WalletOverview,
	WalletQuery,
	WalletSwitcher,
	WithdrawInput,
} from "@projective/types/finance";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";
import {
	accessOf,
	activityOf,
	fundingOf,
	invoicesOf,
	ledgerCsvOf,
	methodsOf,
	overviewOf,
	payoutsOf,
	switcherOf,
	transactionsOf,
} from "./live-wallet.ts";
import * as actions from "./wallet-actions.ts";
import { resolveWalletContext, type WalletContext } from "./wallet-scope.ts";

/**
 * WalletBackendService — the FAT half of the context-scoped Wallet & Finance surface (`/wallet`, its
 * deep pages and its action modals): every read projection and every money action, each returning a
 * transport-agnostic {@link ServiceResult}.
 *
 * Everything reads and writes LIVE as the signed-in caller (`wallet-scope` · `live-wallet` ·
 * `wallet-actions`). ALL money math is server-side; the client only renders the `MoneyView`s returned.
 * A guest gets a 401, and an unexpected failure a 503 — never a sample wallet.
 */

type Result<T> = ServiceResult<T>;

const SIGNED_OUT = fail(401, { message: "Sign in to see your wallet." });
const UNREACHABLE = fail(503, { message: "We couldn't reach your wallet just now. Try again in a moment." });

/** Resolve the read, run it, and turn any unexpected failure into a 503 rather than a throw. */
async function read<T>(
	label: string,
	query: WalletQuery,
	actor: ReadActor,
	run: (ctx: WalletContext) => Promise<T> | T,
): Promise<Result<T>> {
	try {
		const ctx = await resolveWalletContext(query, actor);
		if (!ctx) return SIGNED_OUT as Result<T>;
		return ok(await run(ctx));
	} catch (error) {
		console.error(`[wallet:${label}]`, error instanceof Error ? error.message : error);
		return UNREACHABLE as Result<T>;
	}
}

/** Run a mutation; an unexpected failure is a 503, and nothing is reported as done. */
async function write(
	label: string,
	run: () => Promise<Result<{ result: WalletActionResult }>> | Result<{ result: WalletActionResult }>,
): Promise<Result<{ result: WalletActionResult }>> {
	try {
		return await run();
	} catch (error) {
		console.error(`[wallet:${label}]`, error instanceof Error ? error.message : error);
		return fail(503, {
			message: "We couldn't reach your wallet just now. Check its balance before trying again.",
		}) as Result<{ result: WalletActionResult }>;
	}
}

export class WalletBackendService {
	/** The wallet switcher (active wallet · selectable accounts · the read-only aggregate rollup). */
	static switcher(query: WalletQuery, actor: ReadActor): Promise<Result<{ switcher: WalletSwitcher }>> {
		return read("switcher", query, actor, (ctx) => ({ switcher: switcherOf(ctx) }));
	}

	/** The Overview hub projection for the query's wallet (or the aggregate). */
	static overview(query: WalletQuery, actor: ReadActor): Promise<Result<{ overview: WalletOverview }>> {
		return read("overview", query, actor, async (ctx) => ({ overview: await overviewOf(ctx) }));
	}

	/**
	 * The Overview AND the switcher from ONE resolution of the viewer's wallets — what the page, the lane
	 * and the header band need together, and what a currency or account switch refreshes together.
	 */
	static overviewWithSwitcher(
		query: WalletQuery,
		actor: ReadActor,
	): Promise<Result<{ overview: WalletOverview; switcher: WalletSwitcher }>> {
		return read("overview", query, actor, async (ctx) => ({
			overview: await overviewOf(ctx),
			switcher: switcherOf(ctx),
		}));
	}

	/** A filtered, sorted, paged page of the ledger for the Transactions table. */
	static transactions(
		query: WalletQuery,
		params: TransactionListParams,
		actor: ReadActor,
	): Promise<Result<{ page: TransactionPage }>> {
		return read("transactions", query, actor, async (ctx) => ({ page: await transactionsOf(ctx, params) }));
	}

	/** The Activity charts projection. */
	static activity(
		query: WalletQuery,
		range: ActivityRange,
		actor: ReadActor,
	): Promise<Result<{ activity: ActivityView }>> {
		return read("activity", query, actor, async (ctx) => ({ activity: await activityOf(ctx, range) }));
	}

	/** The Payouts projection. */
	static payouts(query: WalletQuery, actor: ReadActor): Promise<Result<{ payouts: PayoutsView }>> {
		return read("payouts", query, actor, async (ctx) => ({ payouts: await payoutsOf(ctx) }));
	}

	/** The Funding projection. */
	static funding(query: WalletQuery, actor: ReadActor): Promise<Result<{ funding: FundingView }>> {
		return read("funding", query, actor, async (ctx) => ({ funding: await fundingOf(ctx) }));
	}

	/** The Methods projection. */
	static methods(query: WalletQuery, actor: ReadActor): Promise<Result<{ methods: MethodsView }>> {
		return read("methods", query, actor, async (ctx) => ({ methods: await methodsOf(ctx) }));
	}

	/** The Invoices projection (business). */
	static invoices(query: WalletQuery, actor: ReadActor): Promise<Result<{ invoices: InvoicesView }>> {
		return read("invoices", query, actor, async (ctx) => ({ invoices: await invoicesOf(ctx) }));
	}

	/** The Access projection (team/business). */
	static access(query: WalletQuery, actor: ReadActor): Promise<Result<{ access: AccessView }>> {
		return read("access", query, actor, async (ctx) => ({ access: await accessOf(ctx) }));
	}

	/** The wallet's ledger as CSV (each amount in the currency it was stored in). */
	static exportLedger(query: WalletQuery, actor: ReadActor): Promise<Result<{ filename: string; csv: string }>> {
		return read("export", query, actor, (ctx) => ledgerCsvOf(ctx));
	}

	// #region Mutations
	static topUp(input: TopUpInput) {
		return write("top-up", () => actions.topUp(input));
	}

	static withdraw(input: WithdrawInput) {
		return write("withdraw", () => actions.withdraw(input));
	}

	static transfer(input: TransferInput, query: WalletQuery, actor: ReadActor) {
		return write("transfer", () => actions.transfer(input, query, actor));
	}

	static distribute(input: DistributeInput, query: WalletQuery, actor: ReadActor) {
		return write("distribute", () => actions.distribute(input, query, actor));
	}

	static fundEscrow(input: FundEscrowInput, query: WalletQuery, actor: ReadActor) {
		return write("fund-escrow", () => actions.fundEscrow(input, query, actor));
	}

	static addRecurring(input: DepositRuleInput) {
		return write("recurring", () => actions.addRecurring(input));
	}

	static addMethod(input: AddMethodInput) {
		return write("method", () => actions.addMethod(input));
	}

	static setPayout(input: PayoutScheduleInput, query: WalletQuery, actor: ReadActor) {
		return write("payout", () => actions.setPayout(input, query, actor));
	}

	static requestSpend(input: SpendRequestInput, query: WalletQuery, actor: ReadActor) {
		return write("spend-request", () => actions.requestSpend(input, query, actor));
	}

	static decideSpend(input: SpendDecisionInput, query: WalletQuery, actor: ReadActor) {
		return write("spend-decision", () => actions.decideSpend(input, query, actor));
	}

	static enrolSmoother(input: IncomeSmootherEnrolInput) {
		return write("smoother", () => actions.enrolSmoother(input));
	}
	// #endregion
}
