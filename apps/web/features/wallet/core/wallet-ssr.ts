import type { UserContext } from "@projective/types/auth";
import { WalletBackendService } from "@server/services/finance/WalletBackendService.ts";
import { toActivityRange, walletQueryFrom } from "./wallet-model.ts";
import type {
	AccessView,
	ActivityView,
	FundingView,
	InvoicesView,
	MethodsView,
	PayoutsView,
	TransactionListParams,
	TransactionPage,
	WalletOverview,
	WalletSwitcher,
} from "../types/wallet-types.ts";

/**
 * wallet-ssr — the server-only bootstraps for the Wallet surface's first paint. They call the fat
 * {@link WalletBackendService} directly (no HTTP hop) so the overview / deep pages + the lane ship their
 * first byte resolved from the active context's wallet; the islands then refine via the thin
 * {@link WalletService}. Mirror `resolveCataloguePage` / `resolveProjectsFeed`. Never imported by an
 * island.
 *
 * The chrome-only display currency defaults to the wallet's own until the live user-preferences read is
 * wired (the pref lives in `org.user_preferences`, not the chrome JWT — flagged); the dev currency axis
 * overrides it client-side (the island refetches). Simulation knobs are absent on the first byte (the
 * server never sees the client dev seam) and applied on the island's first refetch.
 */

/** Everything the Overview page + the lane need without a client round-trip. */
export interface WalletOverviewBootstrap {
	overview: WalletOverview;
	switcher: WalletSwitcher;
}

/** Resolve the Overview hub + the wallet switcher for the request. */
export function resolveWalletOverview(context: UserContext, url: URL): WalletOverviewBootstrap {
	const query = walletQueryFrom(url.searchParams, context);
	const ov = WalletBackendService.overview(query);
	const sw = WalletBackendService.switcher(query);
	return {
		overview: ov.ok && ov.data ? ov.data.overview : EMPTY_OVERVIEW,
		switcher: sw.ok && sw.data ? sw.data.switcher : EMPTY_SWITCHER,
	};
}

/** Resolve just the wallet switcher (the lane slot). */
export function resolveWalletSwitcher(context: UserContext, url: URL): WalletSwitcher {
	const sw = WalletBackendService.switcher(walletQueryFrom(url.searchParams, context));
	return sw.ok && sw.data ? sw.data.switcher : EMPTY_SWITCHER;
}

/**
 * Resolve the display currency for the first paint: an explicit `?display=` override, else the active
 * wallet's own currency (so a EUR vault paints in EUR without a client refetch). The dev currency axis
 * overrides it client-side. Threaded into every deep page so the island seeds the matching currency.
 */
export function resolveDisplayCurrency(context: UserContext, url: URL): string {
	const explicit = url.searchParams.get("display");
	if (explicit) return explicit.toUpperCase();
	const sw = WalletBackendService.switcher(walletQueryFrom(url.searchParams, context));
	return sw.ok && sw.data ? sw.data.switcher.active.available.currency : "GBP";
}

/** Resolve the initial transactions page. */
export function resolveTransactions(context: UserContext, url: URL): { page: TransactionPage } {
	const query = walletQueryFrom(url.searchParams, context);
	const params: TransactionListParams = { limit: 40 };
	const res = WalletBackendService.transactions(query, params);
	return { page: res.ok && res.data ? res.data.page : EMPTY_TXN_PAGE };
}

/** Resolve the initial Activity projection. */
export function resolveActivity(context: UserContext, url: URL): ActivityView {
	const query = walletQueryFrom(url.searchParams, context);
	const range = toActivityRange(url.searchParams.get("range"));
	const res = WalletBackendService.activity(query, range);
	return res.ok && res.data ? res.data.activity : EMPTY_ACTIVITY;
}

/** Resolve the Payouts projection. */
export function resolvePayouts(context: UserContext, url: URL): PayoutsView {
	const res = WalletBackendService.payouts(walletQueryFrom(url.searchParams, context));
	return res.ok && res.data ? res.data.payouts : EMPTY_PAYOUTS;
}

/** Resolve the Funding projection. */
export function resolveFunding(context: UserContext, url: URL): FundingView {
	const res = WalletBackendService.funding(walletQueryFrom(url.searchParams, context));
	return res.ok && res.data ? res.data.funding : { sources: [], rules: [], balance: ZERO_MONEY };
}

/** Resolve the Methods projection. */
export function resolveMethods(context: UserContext, url: URL): MethodsView {
	const res = WalletBackendService.methods(walletQueryFrom(url.searchParams, context));
	return res.ok && res.data ? res.data.methods : { methods: [] };
}

/** Resolve the Invoices projection. */
export function resolveInvoices(context: UserContext, url: URL): InvoicesView {
	const res = WalletBackendService.invoices(walletQueryFrom(url.searchParams, context));
	return res.ok && res.data
		? res.data.invoices
		: { current: null, statements: [], bills: [], caps: [] };
}

/** Resolve the Access projection. */
export function resolveAccess(context: UserContext, url: URL): AccessView {
	const res = WalletBackendService.access(walletQueryFrom(url.searchParams, context));
	return res.ok && res.data
		? res.data.access
		: { members: [], caps: [], approvals: [], audit: [], viewerCapabilities: ["view"] };
}

// #region Empty fallbacks (a degraded but coherent first paint)
const ZERO_MONEY = { minor: 0, currency: "GBP", display: "£0.00", origin: null };
const EMPTY_VERIFICATION = {
	subject: "freelancer" as const,
	kycStatus: "verified" as const,
	tier: 2,
	payoutReady: true,
	canWithdraw: true,
	canEarn: true,
	prompt: null,
	href: null,
};
const EMPTY_REF = {
	scope: "personal" as const,
	id: "",
	handle: null,
	name: "Wallet",
	avatar: null,
	role: null,
	available: ZERO_MONEY,
};
const EMPTY_OVERVIEW: WalletOverview = {
	ref: EMPTY_REF,
	variant: "personal",
	balances: {
		currency: "GBP",
		availableCents: 0,
		lockedCents: 0,
		pendingCents: 0,
		onHoldCents: 0,
		lifetimeCents: 0,
	},
	available: ZERO_MONEY,
	locked: ZERO_MONEY,
	pending: ZERO_MONEY,
	onHold: ZERO_MONEY,
	lifetime: ZERO_MONEY,
	incoming: [],
	flow: [],
	flowRange: "90d",
	recent: [],
	quickActions: [],
	capabilities: ["view"],
	verification: EMPTY_VERIFICATION,
	personal: null,
	team: null,
	business: null,
};
const EMPTY_SWITCHER: WalletSwitcher = {
	active: EMPTY_REF,
	accounts: [EMPTY_REF],
	aggregate: { ...EMPTY_REF, scope: "aggregate", name: "All accounts" },
};
const EMPTY_TXN_PAGE: TransactionPage = {
	items: [],
	hasMore: false,
	nextCursor: null,
	total: 0,
	projects: [],
};
const EMPTY_ACTIVITY: ActivityView = {
	range: "90d",
	flow: [],
	byCategory: [],
	byProject: [],
	totalIn: ZERO_MONEY,
	totalOut: ZERO_MONEY,
	net: ZERO_MONEY,
	lockedCapital: null,
	projectedIncome: null,
	burnDown: null,
};
const EMPTY_PAYOUTS: PayoutsView = {
	schedule: {
		mode: "manual",
		destinationLabel: null,
		threshold: null,
		instant: false,
		nextRunLabel: null,
	},
	destinations: [],
	incomeSmoother: null,
	instantAvailable: ZERO_MONEY,
	instantFeeLabel: "",
	history: [],
	verification: EMPTY_VERIFICATION,
};
// #endregion
