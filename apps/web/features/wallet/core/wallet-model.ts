import type { UserContext } from "@projective/types/auth";
import type {
	ActivityRange,
	FundState,
	LedgerKind,
	LedgerSettlement,
	MoneyView,
	TransactionListParams,
	TxnCategory,
	WalletAction,
	WalletQuery,
	WalletScope,
} from "../types/wallet-types.ts";
import { LedgerKind as LedgerKindEnum } from "../types/wallet-types.ts";

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
		timezone: sp.get("tz"),
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

/**
 * The address of a wallet page for a wallet and currency; `flow` is carried where the page reads it,
 * and left off where it is that page's own default.
 */
export function walletPageHref(
	view: WalletView,
	wallet: string,
	display?: string | null,
	flow?: FlowPeriod | null,
): string {
	const params = new URLSearchParams(buildWalletQuery({ wallet, display }));
	if (flow && flow !== defaultPeriodFor(view) && viewShowsRuler(view)) params.set("flow", flow);
	const qs = params.toString();
	return `${VIEW_PATH[view]}${qs ? `?${qs}` : ""}`;
}

/** The wallet page a pathname addresses, or `null` when it names none. */
export function viewOfPath(pathname: string): WalletView | null {
	const path = pathname.replace(/\/+$/, "") || "/";
	const found = WALLET_VIEWS.find((view) => VIEW_PATH[view] === path);
	return found ?? null;
}

/**
 * Whether a page is read over a window, and so carries the pinned range ruler: the overview and the
 * analytics draw a cash-flow window, the ledger lists one.
 */
export function viewShowsRuler(view: WalletView): boolean {
	return view === "overview" || view === "analytics" || view === "transactions";
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

/**
 * The window a page opens on when `?flow=` names none: the ledger lists everything until the reader
 * narrows it; the cash-flow pages draw the last month.
 */
export function defaultPeriodFor(view: WalletView): FlowPeriod {
	return view === "transactions" ? "all" : DEFAULT_FLOW_PERIOD;
}

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

/**
 * Parses the page's `?flow=` param; a pre-ruler name maps across, anything else is `fallback` (the
 * cash-flow default unless the page says otherwise).
 */
export function toFlowPeriod(
	raw: string | null | undefined,
	fallback: FlowPeriod = DEFAULT_FLOW_PERIOD,
): FlowPeriod {
	if (FLOW_PERIODS.includes(raw as FlowPeriod)) return raw as FlowPeriod;
	return (raw && LEGACY_PERIOD[raw]) || fallback;
}
// #endregion

// #region Ledger filters
/** The direction toggle as the page's URL names it. */
export type LedgerDirection = "all" | "in" | "out";

/**
 * The Transactions page's filter bar, as the reader set it — synced to the page's own URL (`?q=` ·
 * `?dir=in|out` · `?kind=a,b` · `?flow=`) so a filtered ledger can be linked, reloaded and shared.
 */
export interface LedgerFilters {
	q: string;
	dir: LedgerDirection;
	kinds: LedgerKind[];
	period: FlowPeriod;
}

/** The line families the category selector offers, in the order it lists them. */
export const LEDGER_KIND_CHOICES: readonly LedgerKind[] = [
	"escrow_release",
	"service_sale",
	"product_sale",
	"order_payment",
	"platform_fee",
	"topup",
	"payout",
	"transfer",
	"refund",
];

const KIND_LABEL: Readonly<Record<LedgerKind, string>> = {
	escrow_release: "Escrow releases",
	escrow_hold: "Escrow funded",
	service_sale: "Service sales",
	product_sale: "Product sales",
	order_payment: "Order payments",
	platform_fee: "Platform fees",
	topup: "Top-ups",
	payout: "Payouts",
	transfer: "Transfers",
	refund: "Refunds",
	other: "Other",
};

/** A line family's plural label ("Escrow releases"). */
export function ledgerKindLabel(kind: LedgerKind): string {
	return KIND_LABEL[kind];
}

const SETTLEMENT_LABEL: Readonly<Record<LedgerSettlement, string>> = {
	cleared: "Cleared",
	pending: "Pending",
	disputed: "Disputed",
};

/** A line's settlement state, as a word. */
export function settlementLabel(settlement: LedgerSettlement): string {
	return SETTLEMENT_LABEL[settlement];
}

const SEARCH_MAX = 160;

function kindsFrom(raw: string | null): LedgerKind[] {
	if (!raw) return [];
	const wanted = new Set(raw.split(",").map((k) => k.trim()));
	return LedgerKindEnum.options.filter((k) => k !== "other" && wanted.has(k));
}

/** The filter bar's state from the page's URL; anything unrecognised is the unfiltered default. */
export function ledgerFiltersFrom(sp: URLSearchParams): LedgerFilters {
	const dir = sp.get("dir");
	return {
		q: (sp.get("q") ?? "").slice(0, SEARCH_MAX),
		dir: dir === "in" || dir === "out" ? dir : "all",
		kinds: kindsFrom(sp.get("kind")),
		period: toFlowPeriod(sp.get("flow"), defaultPeriodFor("transactions")),
	};
}

/** Whether the search, direction or category narrows the ledger (the window is the ruler's). */
export function ledgerFiltered(f: LedgerFilters): boolean {
	return f.q.trim() !== "" || f.dir !== "all" || f.kinds.length > 0;
}

/**
 * Writes the filter bar into a copy of the page's query, leaving every other param (`w`, `display`)
 * alone and dropping each filter that is at its default, so an unfiltered ledger has a clean address.
 */
export function withLedgerFilters(base: URLSearchParams, f: LedgerFilters): URLSearchParams {
	const next = new URLSearchParams(base);
	const q = f.q.trim();
	if (q) next.set("q", q);
	else next.delete("q");
	if (f.dir !== "all") next.set("dir", f.dir);
	else next.delete("dir");
	if (f.kinds.length > 0) next.set("kind", f.kinds.join(","));
	else next.delete("kind");
	if (f.period !== defaultPeriodFor("transactions")) next.set("flow", f.period);
	else next.delete("flow");
	return next;
}

/** The ledger read the filter bar asks for (keyset paging is added per page). */
export function ledgerParamsOf(f: LedgerFilters): TransactionListParams {
	const q = f.q.trim();
	return {
		search: q || undefined,
		direction: f.dir === "in" ? "credit" : f.dir === "out" ? "debit" : undefined,
		kinds: f.kinds.length > 0 ? f.kinds : undefined,
		range: f.period === "all" ? undefined : periodRange(f.period),
	};
}

/** A ledger read as `/api/wallet/transactions` (and `/api/wallet/export`) query params. */
export function ledgerApiParams(params: TransactionListParams): Record<string, string> {
	const out: Record<string, string> = {};
	if (params.search) out.search = params.search;
	if (params.direction) out.direction = params.direction;
	if (params.fundState) out.fundState = params.fundState;
	if (params.category) out.category = params.category;
	if (params.kinds && params.kinds.length > 0) out.kinds = params.kinds.join(",");
	if (params.range) out.range = params.range;
	if (params.project) out.project = params.project;
	if (params.from) out.from = params.from;
	if (params.to) out.to = params.to;
	if (params.sort) out.sort = params.sort;
	if (params.dir) out.dir = params.dir;
	if (params.cursor) out.cursor = params.cursor;
	if (params.limit) out.limit = String(params.limit);
	return out;
}

/** The inverse of {@link ledgerApiParams}, for the thin routes; the result is Zod-checked there. */
export function ledgerApiParamsFrom(sp: URLSearchParams): TransactionListParams {
	const limit = Number.parseInt(sp.get("limit") ?? "", 10);
	const kinds = kindsFrom(sp.get("kinds"));
	const range = sp.get("range");
	const direction = sp.get("direction");
	const dir = sp.get("dir");
	return {
		search: sp.get("search")?.slice(0, SEARCH_MAX) || undefined,
		direction: direction === "credit" || direction === "debit" ? direction : undefined,
		fundState: (sp.get("fundState") || undefined) as TransactionListParams["fundState"],
		category: (sp.get("category") || undefined) as TransactionListParams["category"],
		kinds: kinds.length > 0 ? kinds : undefined,
		range: range && ACTIVITY_RANGES.includes(range as ActivityRange)
			? range as ActivityRange
			: undefined,
		project: sp.get("project") || undefined,
		from: sp.get("from") || undefined,
		to: sp.get("to") || undefined,
		sort: (sp.get("sort") || undefined) as TransactionListParams["sort"],
		dir: dir === "asc" || dir === "desc" ? dir : undefined,
		cursor: sp.get("cursor") || null,
		limit: Number.isFinite(limit) ? limit : undefined,
	};
}

/** The browser's IANA time zone, or `null` where it cannot be read (the server, an old engine). */
export function browserTimeZone(): string | null {
	try {
		return typeof Intl !== "undefined"
			? Intl.DateTimeFormat().resolvedOptions().timeZone ?? null
			: null;
	} catch {
		return null;
	}
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
