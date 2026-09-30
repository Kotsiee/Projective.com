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

const ACTIVITY_RANGES: readonly ActivityRange[] = ["7d", "30d", "90d", "180d", "12m", "5y", "all"];

/** Parses the `/api/wallet/activity` range; absent or unknown stays `90d`, the endpoint's default. */
export function toActivityRange(raw: string | null): ActivityRange {
	return ACTIVITY_RANGES.includes(raw as ActivityRange) ? raw as ActivityRange : "90d";
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

// #region Pages
/**
 * The wallet's pages. The command centre is `overview`; the ledger, the analytics and a business
 * vault's invoices each have an address of their own, and every one of them carries `?w=` and
 * `?display=` so moving between them never changes which wallet or currency the reader is looking at.
 */
export type WalletView = "overview" | "transactions" | "analytics" | "invoices";

/** Every wallet page, in navigation order. */
export const WALLET_VIEWS: readonly WalletView[] = [
	"overview",
	"transactions",
	"analytics",
	"invoices",
];

const VIEW_PATH: Readonly<Record<WalletView, string>> = {
	overview: "/wallet",
	transactions: "/wallet/transactions",
	analytics: "/wallet/analytics",
	invoices: "/wallet/invoices",
};

const VIEW_LABEL: Readonly<Record<WalletView, string>> = {
	overview: "Overview",
	transactions: "Transactions",
	analytics: "Analytics",
	invoices: "Invoices & statements",
};

/** A wallet page's name, as the lane lists it and the page heads itself. */
export function viewLabel(view: WalletView): string {
	return VIEW_LABEL[view];
}

/** The address of a wallet page for a wallet and currency; `flow` is carried where the page reads it. */
export function walletPageHref(
	view: WalletView,
	wallet: string,
	display?: string | null,
	flow?: FlowPeriod | null,
): string {
	const params = new URLSearchParams(buildWalletQuery({ wallet, display }));
	if (flow && flow !== DEFAULT_FLOW_PERIOD && viewShowsRuler(view)) params.set("flow", flow);
	const qs = params.toString();
	return `${VIEW_PATH[view]}${qs ? `?${qs}` : ""}`;
}

/** The wallet page a pathname addresses, or `null` when it names none. */
export function viewOfPath(pathname: string): WalletView | null {
	const path = pathname.replace(/\/+$/, "") || "/";
	const found = WALLET_VIEWS.find((view) => VIEW_PATH[view] === path);
	return found ?? null;
}

/** Whether a page draws a cash-flow window, and so carries the pinned range ruler. */
export function viewShowsRuler(view: WalletView): boolean {
	return view === "overview" || view === "analytics";
}

/**
 * Whether a wallet has a page of its own for invoices and statements. Only a business vault is billed
 * and receives monthly statements; the server answers an empty view for every other wallet.
 */
export function hasInvoices(business: unknown): boolean {
	return business !== null && business !== undefined;
}
// #endregion

// #region Cash-flow period
/**
 * A cash-flow window as the pinned range ruler names it — and as the page's `?flow=` param
 * carries it, so a window can be linked and survives a reload.
 */
export type FlowPeriod = "7d" | "1m" | "3m" | "6m" | "1y" | "5y" | "all";

/** Every period, in ruler order (shortest window first). */
export const FLOW_PERIODS: readonly FlowPeriod[] = ["7d", "1m", "3m", "6m", "1y", "5y", "all"];

/** The period the page opens on when `?flow=` names none. */
export const DEFAULT_FLOW_PERIOD: FlowPeriod = "1m";

const PERIOD_RANGE: Readonly<Record<FlowPeriod, ActivityRange>> = {
	"7d": "7d",
	"1m": "30d",
	"3m": "90d",
	"6m": "180d",
	"1y": "12m",
	"5y": "5y",
	all: "all",
};

const PERIOD_LABEL: Readonly<Record<FlowPeriod, string>> = {
	"7d": "7D",
	"1m": "1M",
	"3m": "3M",
	"6m": "6M",
	"1y": "1Y",
	"5y": "5Y",
	all: "All",
};

const PERIOD_PHRASE: Readonly<Record<FlowPeriod, string>> = {
	"7d": "the last 7 days",
	"1m": "the last 30 days",
	"3m": "the last 3 months",
	"6m": "the last 6 months",
	"1y": "the last 12 months",
	"5y": "the last 5 years",
	all: "all time",
};

/**
 * The names `?flow=` carried before the ruler, so a bookmarked window still opens on the same span
 * rather than falling back to the default.
 */
const LEGACY_PERIOD: Readonly<Record<string, FlowPeriod>> = {
	week: "7d",
	month: "1m",
	quarter: "3m",
	year: "1y",
};

/** The server window a period is summed over. */
export function periodRange(period: FlowPeriod): ActivityRange {
	return PERIOD_RANGE[period];
}

/** The ruler's short label for a period ("7D", "All"). */
export function periodLabel(period: FlowPeriod): string {
	return PERIOD_LABEL[period];
}

/** The window a period covers, phrased for a sentence ("the last 3 months"). */
export function periodPhrase(period: FlowPeriod): string {
	return PERIOD_PHRASE[period];
}

/** Whether a period's chart slices span more than a day, so a bar is read as "from" its start date. */
export function periodSlicesAreSpans(period: FlowPeriod): boolean {
	return period !== "7d" && period !== "1m";
}

/** Parses the page's `?flow=` param; a pre-ruler name maps across, anything else is the default. */
export function toFlowPeriod(raw: string | null | undefined): FlowPeriod {
	if (FLOW_PERIODS.includes(raw as FlowPeriod)) return raw as FlowPeriod;
	return (raw && LEGACY_PERIOD[raw]) || DEFAULT_FLOW_PERIOD;
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
			return "Reserved";
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
