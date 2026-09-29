import type { UserContext } from "@projective/types/auth";
import type {
	ActivityRange,
	FundState,
	MoneyView,
	TxnCategory,
	WalletAction,
	WalletQuery,
	WalletScope,
} from "../types/wallet-types.ts";

// #region Wallet param (scope:id) ⇄ query
/** Encodes a wallet reference as the `?w=` param (`personal` · `team:{id}` · `aggregate`). */
export function walletParam(scope: WalletScope, id: string): string {
	if (scope === "personal") return "personal";
	if (scope === "aggregate") return "aggregate";
	return `${scope}:${id}`;
}

/** The wallet param of the active context, falling back to `personal`. */
export function defaultWalletParam(context: UserContext): string {
	switch (context.contextType) {
		case "team":
			return context.contextId ? `team:${context.contextId}` : "personal";
		case "business":
			return context.contextId ? `business:${context.contextId}` : "personal";
		case "organisation":
			return context.contextId ? `organisation:${context.contextId}` : "personal";
		default:
			return "personal";
	}
}

/** Serialises the wallet + display currency into a `/api/wallet/*` query string. */
export function buildWalletQuery(
	opts: { wallet?: string | null; display?: string | null },
): string {
	const qs = new URLSearchParams();
	if (opts.wallet && opts.wallet !== "personal") qs.set("w", opts.wallet);
	if (opts.display) qs.set("display", opts.display);
	return qs.toString();
}

/** Builds the fat-service {@link WalletQuery} from a request URL and the acting context. */
export function walletQueryFrom(sp: URLSearchParams, context: UserContext): WalletQuery {
	return {
		wallet: sp.get("w") ?? defaultWalletParam(context),
		display: sp.get("display"),
		viewerCurrency: context.displayCurrency ?? null,
	};
}

/** Parses the `/api/wallet/activity` range; absent or unknown stays `90d`, the endpoint's default. */
export function toActivityRange(raw: string | null): ActivityRange {
	return raw === "7d" || raw === "30d" || raw === "12m" ? raw : "90d";
}

/** The `/wallet` address for a wallet and currency, optionally at a section anchor. */
export function walletHref(
	wallet: string,
	display?: string | null,
	section?: string | null,
): string {
	const qs = buildWalletQuery({ wallet, display });
	return `/wallet${qs ? `?${qs}` : ""}${section ? `#${section}` : ""}`;
}
// #endregion

// #region Cash-flow period
/** A cash-flow window as the period control names it. */
export type FlowPeriod = "week" | "month" | "quarter" | "year";

/** Every period, in control order. */
export const FLOW_PERIODS: readonly FlowPeriod[] = ["week", "month", "quarter", "year"];

/** The period the page opens on when `?flow=` names none. */
export const DEFAULT_FLOW_PERIOD: FlowPeriod = "month";

const PERIOD_RANGE: Readonly<Record<FlowPeriod, ActivityRange>> = {
	week: "7d",
	month: "30d",
	quarter: "90d",
	year: "12m",
};

const PERIOD_LABEL: Readonly<Record<FlowPeriod, string>> = {
	week: "Week",
	month: "Month",
	quarter: "Quarter",
	year: "Year",
};

const PERIOD_PHRASE: Readonly<Record<FlowPeriod, string>> = {
	week: "the last 7 days",
	month: "the last 30 days",
	quarter: "the last 90 days",
	year: "the last 12 months",
};

/** The server window a period is summed over. */
export function periodRange(period: FlowPeriod): ActivityRange {
	return PERIOD_RANGE[period];
}

/** The control label for a period. */
export function periodLabel(period: FlowPeriod): string {
	return PERIOD_LABEL[period];
}

/** The window a period covers, phrased for a sentence. */
export function periodPhrase(period: FlowPeriod): string {
	return PERIOD_PHRASE[period];
}

/** Parses the page's `?flow=` param; anything unrecognised is the default period. */
export function toFlowPeriod(raw: string | null | undefined): FlowPeriod {
	return FLOW_PERIODS.includes(raw as FlowPeriod) ? raw as FlowPeriod : DEFAULT_FLOW_PERIOD;
}
// #endregion

// #region Labels
const CATEGORY_LABEL: Readonly<Record<TxnCategory, string>> = {
	earning: "Earnings",
	payout: "Payout",
	deposit: "Deposit",
	withdrawal: "Withdrawal",
	fee: "Fee",
	refund: "Refund",
	escrow: "Escrow",
	transfer: "Transfer",
	spend: "Spend",
};

/** A ledger category's short label. */
export function categoryLabel(category: TxnCategory): string {
	return CATEGORY_LABEL[category];
}

/** A fund state's label. */
export function fundStateLabel(state: FundState): string {
	switch (state) {
		case "available":
			return "Available";
		case "locked":
			return "In escrow";
		case "pending":
			return "Clearing";
		case "on_hold":
			return "On hold";
	}
}

/** Each action's verb-first, amount-free label. */
export const ACTION_LABEL: Readonly<Record<WalletAction, string>> = {
	top_up: "Top up",
	withdraw: "Withdraw",
	transfer: "Transfer",
	distribute: "Split",
	fund_escrow: "Fund escrow",
	new_recurring: "Recurring deposit",
	add_method: "Add payment method",
	set_payout: "Payout schedule",
	request_spend: "Request spend",
	enrol_smoother: "Smooth my income",
};
// #endregion

// #region Money facts
/** The amount and currency a figure is actually held in (its origin when converted for display). */
export function heldIn(view: MoneyView): { minor: number; currency: string } {
	return view.origin
		? { minor: view.origin.minor, currency: view.origin.currency.toUpperCase() }
		: { minor: view.minor, currency: view.currency.toUpperCase() };
}

/** Whether an in-app href leads somewhere other than `/wallet` itself. */
export function isElsewhere(href: string | null | undefined): href is string {
	return typeof href === "string" && href.startsWith("/") && !/^\/wallet(?:[/?#]|$)/.test(href);
}
// #endregion
