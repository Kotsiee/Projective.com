import { getWallet, postWallet } from "./api.ts";
import { buildSimQuery } from "./wallet-model.ts";
import type { WalletResult } from "../types/results.ts";
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
	WalletSim,
	WalletSwitcher,
	WithdrawInput,
} from "../types/wallet-types.ts";

/**
 * WalletService — the THIN client controller for the `/wallet` surface. A dumb object of named methods;
 * each builds a query string / JSON payload and forwards to `/api/wallet/*`, returning a soft
 * {@link WalletResult}. No money math, no fixtures — the fat {@link WalletBackendService} owns the reads
 * AND the mutations; the overview / deep-page / lane / modal islands call these for their refines and
 * money moves (mirrors `CatalogueService`). All action payloads carry the target wallet + the viewer's
 * display currency, so the fat service returns amounts pre-converted + formatted (the client only renders
 * them).
 */

/** The shared client context every call threads (the active wallet, display currency, dev simulation). */
export interface WalletContext {
	wallet: string | null;
	display: string | null;
	sim?: WalletSim;
}

function qs(ctx: WalletContext, extra?: Record<string, string>): string {
	const base = buildSimQuery(ctx);
	const params = new URLSearchParams(base);
	if (extra) { for (const [k, v] of Object.entries(extra)) if (v) params.set(k, v); }
	const s = params.toString();
	return s ? `?${s}` : "";
}

export const WalletService = {
	/** The Overview hub + the wallet switcher for the active wallet. */
	overview(
		ctx: WalletContext,
	): Promise<WalletResult<{ overview: WalletOverview; switcher: WalletSwitcher }>> {
		return getWallet(`/api/wallet/overview${qs(ctx)}`);
	},

	/** The wallet switcher only (the lane's account switcher refresh). */
	switcher(ctx: WalletContext): Promise<WalletResult<{ switcher: WalletSwitcher }>> {
		return getWallet(`/api/wallet/switcher${qs(ctx)}`);
	},

	/** A filtered, sorted, paged page of the ledger. */
	transactions(
		ctx: WalletContext,
		params: TransactionListParams,
	): Promise<WalletResult<{ page: TransactionPage }>> {
		const extra: Record<string, string> = {};
		if (params.search) extra.search = params.search;
		if (params.direction) extra.direction = params.direction;
		if (params.fundState) extra.fundState = params.fundState;
		if (params.category) extra.category = params.category;
		if (params.project) extra.project = params.project;
		if (params.from) extra.from = params.from;
		if (params.to) extra.to = params.to;
		if (params.sort) extra.sort = params.sort;
		if (params.dir) extra.dir = params.dir;
		if (params.cursor) extra.cursor = params.cursor;
		if (params.limit) extra.limit = String(params.limit);
		return getWallet(`/api/wallet/transactions${qs(ctx, extra)}`);
	},

	/** The Activity charts projection over a range. */
	activity(
		ctx: WalletContext,
		range: ActivityRange,
	): Promise<WalletResult<{ activity: ActivityView }>> {
		return getWallet(`/api/wallet/activity${qs(ctx, { range })}`);
	},

	/** The Payouts projection. */
	payouts(ctx: WalletContext): Promise<WalletResult<{ payouts: PayoutsView }>> {
		return getWallet(`/api/wallet/payouts${qs(ctx)}`);
	},

	/** The Funding projection. */
	funding(ctx: WalletContext): Promise<WalletResult<{ funding: FundingView }>> {
		return getWallet(`/api/wallet/funding${qs(ctx)}`);
	},

	/** The Methods projection. */
	methods(ctx: WalletContext): Promise<WalletResult<{ methods: MethodsView }>> {
		return getWallet(`/api/wallet/methods${qs(ctx)}`);
	},

	/** The Invoices projection (business). */
	invoices(ctx: WalletContext): Promise<WalletResult<{ invoices: InvoicesView }>> {
		return getWallet(`/api/wallet/invoices${qs(ctx)}`);
	},

	/** The Access projection (team/business). */
	access(ctx: WalletContext): Promise<WalletResult<{ access: AccessView }>> {
		return getWallet(`/api/wallet/access${qs(ctx)}`);
	},

	// #region Actions (all POST /api/wallet/action, discriminated by `action`)
	topUp(input: TopUpInput): Promise<WalletResult<{ result: WalletActionResult }>> {
		return postWallet("/api/wallet/action", { action: "top_up", ...input });
	},
	withdraw(input: WithdrawInput): Promise<WalletResult<{ result: WalletActionResult }>> {
		return postWallet("/api/wallet/action", { action: "withdraw", ...input });
	},
	transfer(input: TransferInput): Promise<WalletResult<{ result: WalletActionResult }>> {
		return postWallet("/api/wallet/action", { action: "transfer", ...input });
	},
	distribute(input: DistributeInput): Promise<WalletResult<{ result: WalletActionResult }>> {
		return postWallet("/api/wallet/action", { action: "distribute", ...input });
	},
	fundEscrow(input: FundEscrowInput): Promise<WalletResult<{ result: WalletActionResult }>> {
		return postWallet("/api/wallet/action", { action: "fund_escrow", ...input });
	},
	addRecurring(input: DepositRuleInput): Promise<WalletResult<{ result: WalletActionResult }>> {
		return postWallet("/api/wallet/action", { action: "new_recurring", ...input });
	},
	addMethod(input: AddMethodInput): Promise<WalletResult<{ result: WalletActionResult }>> {
		return postWallet("/api/wallet/action", { action: "add_method", ...input });
	},
	setPayout(input: PayoutScheduleInput): Promise<WalletResult<{ result: WalletActionResult }>> {
		return postWallet("/api/wallet/action", { action: "set_payout", ...input });
	},
	requestSpend(input: SpendRequestInput): Promise<WalletResult<{ result: WalletActionResult }>> {
		return postWallet("/api/wallet/action", { action: "request_spend", ...input });
	},
	decideSpend(input: SpendDecisionInput): Promise<WalletResult<{ result: WalletActionResult }>> {
		return postWallet("/api/wallet/action", { action: "spend_decision", ...input });
	},
	enrolSmoother(
		input: IncomeSmootherEnrolInput,
	): Promise<WalletResult<{ result: WalletActionResult }>> {
		return postWallet("/api/wallet/action", { action: "enrol_smoother", ...input });
	},
	// #endregion
};
