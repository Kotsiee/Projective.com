import { apiFetch } from "@web/utils/api-client.ts";
import { getWallet, postWallet } from "./api.ts";
import { buildWalletQuery, ledgerApiParams } from "./wallet-model.ts";
import type { WalletResult } from "../types/results.ts";
import type { WalletCardHandoff } from "@projective/types/finance";
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

/**
 * The shared client context every call threads: the active wallet, the display currency and the
 * browser's time zone (what "Today" and a cash-flow day mean on the server's side of the read).
 */
export interface WalletContext {
	wallet: string | null;
	display: string | null;
	timezone?: string | null;
}

/** A finished CSV export, or the reason there is none. */
export type WalletExport =
	| { ok: true; blob: Blob; filename: string }
	| { ok: false; message: string };

function qs(ctx: WalletContext, extra?: Record<string, string>): string {
	const base = buildWalletQuery(ctx);
	const params = new URLSearchParams(base);
	if (ctx.timezone) params.set("tz", ctx.timezone);
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
		return getWallet(`/api/wallet/transactions${qs(ctx, ledgerApiParams(params))}`);
	},

	/**
	 * The ledger as CSV, with the page's filters. Only a CSV answer is a file; any other answer is read as
	 * the wallet's JSON refusal and its message returned, so an error is shown, never downloaded.
	 */
	async exportLedger(ctx: WalletContext, params: TransactionListParams): Promise<WalletExport> {
		const query = { ...ledgerApiParams(params) };
		delete query.cursor;
		delete query.limit;
		try {
			const res = await apiFetch(`/api/wallet/export${qs(ctx, query)}`, {
				headers: { accept: "text/csv, application/json" },
			});
			const type = res.headers.get("content-type") ?? "";
			if (res.ok && type.startsWith("text/csv")) {
				const disposition = res.headers.get("content-disposition") ?? "";
				const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "projective-wallet.csv";
				return { ok: true, blob: await res.blob(), filename };
			}
			const body = await res.json().catch(() => null) as { message?: string } | null;
			return { ok: false, message: body?.message ?? "The ledger couldn't be exported just now." };
		} catch {
			return { ok: false, message: "Network error — the export didn't download. Try again." };
		}
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
	/** Top up by card: answers with the PaymentIntent the Payment Element confirms (`result.payment`). */
	topUp(input: TopUpInput): Promise<WalletResult<{ result: WalletActionResult & WalletCardHandoff }>> {
		return postWallet("/api/wallet/action", { action: "top_up", ...input });
	},
	withdraw(input: WithdrawInput): Promise<WalletResult<{ result: WalletActionResult & WalletCardHandoff }>> {
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
	/** Save a card: answers with the SetupIntent the Payment Element confirms (`result.setup`). */
	addMethod(input: AddMethodInput): Promise<WalletResult<{ result: WalletActionResult & WalletCardHandoff }>> {
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
