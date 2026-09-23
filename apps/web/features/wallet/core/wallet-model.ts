import type { UserContext } from "@projective/types/auth";
import type {
	ActivityRange,
	FundState,
	TxnCategory,
	VaultCapability,
	WalletAction,
	WalletQuery,
	WalletScope,
	WalletVariant,
} from "../types/wallet-types.ts";

/**
 * wallet-model — the pure, presentation-agnostic helpers the Wallet islands, routes, and SSR resolvers
 * share: the deep-page vocabulary + hrefs, the URL ⇄ {@link WalletQuery} mapping, and the small
 * display-metadata maps (fund states, categories, actions). No state, no DOM — safe to import anywhere
 * (client or server).
 */

// #region Deep-page vocabulary
/** A wallet deep page (the lane sub-nav + the routes). */
export type WalletView =
	| "overview"
	| "transactions"
	| "activity"
	| "payouts"
	| "funding"
	| "methods"
	| "invoices"
	| "access";

/** A lane sub-nav entry, with its icon key + the gating that hides it for the wrong wallet/role. */
export interface WalletNavEntry {
	view: WalletView;
	label: string;
	icon: string;
	/** Only shown for these variants (omitted → all). */
	variants?: WalletVariant[];
	/** Only shown when the viewer holds this capability (omitted → always). */
	capability?: VaultCapability;
}

/** The full sub-nav in display order (gated per wallet by {@link visibleNav}). */
export const WALLET_NAV: readonly WalletNavEntry[] = [
	{ view: "overview", label: "Overview", icon: "overview" },
	{ view: "transactions", label: "Transactions", icon: "ledger" },
	{ view: "activity", label: "Activity", icon: "activity" },
	{ view: "payouts", label: "Payouts", icon: "payout" },
	{ view: "funding", label: "Funding", icon: "funding" },
	{ view: "methods", label: "Methods", icon: "card" },
	{ view: "invoices", label: "Invoices", icon: "invoice", variants: ["business"] },
	{
		view: "access",
		label: "Access",
		icon: "access",
		variants: ["team", "business"],
		capability: "view",
	},
];

/** The nav entries visible for a given wallet variant + the viewer's capabilities. */
export function visibleNav(
	variant: WalletVariant,
	caps: readonly VaultCapability[],
): WalletNavEntry[] {
	return WALLET_NAV.filter((e) => {
		if (e.variants && !e.variants.includes(variant)) return false;
		if (e.capability && !caps.includes(e.capability)) return false;
		return true;
	});
}
// #endregion

// #region Route hrefs
/** The href for a wallet view, preserving the active wallet param. */
export function walletHref(view: WalletView, walletParam?: string | null): string {
	const base = view === "overview" ? "/wallet" : `/wallet/${view}`;
	const w = walletParam && walletParam !== "personal"
		? `?w=${encodeURIComponent(walletParam)}`
		: "";
	return `${base}${w}`;
}

/** The active view from a pathname (`/wallet` → overview, `/wallet/payouts` → payouts). */
export function activeViewOf(pathname: string): WalletView {
	const segs = pathname.split("/").filter(Boolean); // ["wallet", view?]
	if (segs[0] !== "wallet" || segs.length < 2) return "overview";
	const v = segs[1] as WalletView;
	const known: WalletView[] = [
		"overview",
		"transactions",
		"activity",
		"payouts",
		"funding",
		"methods",
		"invoices",
		"access",
	];
	return known.includes(v) ? v : "overview";
}
// #endregion

// #region Wallet param (scope:id) ⇄ query
/** Encode a wallet reference into the `?w=` param (`personal` · `team:northwind` · `aggregate`). */
export function walletParam(scope: WalletScope, id: string): string {
	if (scope === "personal") return "personal";
	if (scope === "aggregate") return "aggregate";
	return `${scope}:${id}`;
}

/** The default wallet param for a context (the active context's wallet; personal when unresolved). */
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
// #endregion

// #region Read query (URL ⇄ query string)
/** Serialise the client's wallet + display state into a `/api/wallet/*` query string. */
export function buildWalletQuery(opts: { wallet?: string | null; display?: string | null }): string {
	const qs = new URLSearchParams();
	if (opts.wallet && opts.wallet !== "personal") qs.set("w", opts.wallet);
	if (opts.display) qs.set("display", opts.display);
	return qs.toString();
}

/**
 * Build the fat-service {@link WalletQuery} from a request's URL + acting context (server-side). Who is
 * asking is not part of it: the service reads everything as the signed-in caller.
 */
export function walletQueryFrom(sp: URLSearchParams, context: UserContext): WalletQuery {
	return {
		wallet: sp.get("w") ?? defaultWalletParam(context),
		display: sp.get("display"),
		viewerCurrency: context.displayCurrency ?? null,
	};
}

/** Coerce an activity range param, defaulting to 90d. */
export function toActivityRange(raw: string | null): ActivityRange {
	return raw === "30d" || raw === "12m" ? raw : "90d";
}
// #endregion

// #region Display metadata (labels + tones)
/** A fund state's display label + tonal key (drives a chip's `data-tone`). */
export function fundStateMeta(state: FundState): { label: string; tone: string } {
	switch (state) {
		case "available":
			return { label: "Available", tone: "success" };
		case "locked":
			return { label: "In escrow", tone: "info" };
		case "pending":
			return { label: "Clearing", tone: "warning" };
		case "on_hold":
			return { label: "On hold", tone: "danger" };
	}
}

/** A category's short display label. */
export function categoryLabel(cat: TxnCategory): string {
	const map: Record<TxnCategory, string> = {
		earning: "Earnings",
		payout: "Payouts",
		deposit: "Deposits",
		withdrawal: "Withdrawals",
		fee: "Platform fees",
		refund: "Refunds",
		escrow: "Escrow",
		transfer: "Transfers",
		spend: "Spend",
	};
	return map[cat];
}

/** An action's modal title + short label. */
export function actionMeta(action: WalletAction): { label: string; icon: string } {
	const map: Record<WalletAction, { label: string; icon: string }> = {
		top_up: { label: "Top up", icon: "topup" },
		withdraw: { label: "Withdraw", icon: "withdraw" },
		transfer: { label: "Transfer", icon: "transfer" },
		distribute: { label: "Distribute", icon: "distribute" },
		fund_escrow: { label: "Fund escrow", icon: "escrow" },
		new_recurring: { label: "Recurring deposit", icon: "recurring" },
		add_method: { label: "Add method", icon: "card" },
		set_payout: { label: "Payout schedule", icon: "payout" },
		request_spend: { label: "Request spend", icon: "request" },
		enrol_smoother: { label: "Income Smoother", icon: "smoother" },
	};
	return map[action];
}
// #endregion
