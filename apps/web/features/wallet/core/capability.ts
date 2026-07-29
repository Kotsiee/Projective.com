import type {
	VaultCapability,
	WalletAction,
	WalletVariant,
	WalletVerification,
} from "../types/wallet-types.ts";

/**
 * capability — who may operate which money control, and how a blocked control is presented.
 *
 * Two gates that behave DIFFERENTLY, and conflating them is the mistake this module exists to
 * prevent (BUILD CONTRACT §9):
 *
 *  - **Capability** → **absence**. A `member` on a team vault has no business seeing a Distribute
 *    button at all; showing it disabled advertises a power they will never have on this vault.
 *  - **Verification** → **disablement with a reason**. The viewer *does* hold the capability; a
 *    process step is outstanding. Removing the control hides the path; locking it teaches the path.
 *
 * Chrome only. The server re-checks every mutation and RLS is the real gate — these helpers decide
 * what is drawn, never what is permitted.
 */

// #region Capability checks
/** Whether a capability set includes a capability. */
export function can(caps: readonly VaultCapability[], cap: VaultCapability): boolean {
	return caps.includes(cap);
}

/** The capability each money action requires. */
const REQUIRES: Record<WalletAction, VaultCapability> = {
	top_up: "add_funds",
	withdraw: "withdraw",
	transfer: "withdraw",
	distribute: "distribute",
	fund_escrow: "spend",
	new_recurring: "add_funds",
	add_method: "add_funds",
	set_payout: "withdraw",
	request_spend: "view",
	enrol_smoother: "withdraw",
};

/** The actions that additionally require a payout-ready identity (money LEAVING the platform). */
const NEEDS_PAYOUT: ReadonlySet<WalletAction> = new Set([
	"withdraw",
	"set_payout",
	"enrol_smoother",
]);
// #endregion

// #region Resolution
/** A money action as the footer rig should draw it. */
export interface ResolvedAction {
	action: WalletAction;
	label: string;
	/** Present but locked behind an outstanding verification step — rendered, never removed. */
	locked: boolean;
	/** The prompt a locked action's nudge carries; `null` when unlocked. */
	prompt: string | null;
	/** Where the nudge sends the viewer to clear the gate. */
	href: string | null;
}

/** The action labels. Verb-first, amount-free — the amount belongs to the confirmation (RULE O-2). */
export const ACTION_LABEL: Record<WalletAction, string> = {
	top_up: "Top up",
	withdraw: "Withdraw",
	transfer: "Transfer",
	distribute: "Distribute",
	fund_escrow: "Fund escrow",
	new_recurring: "New recurring",
	add_method: "Add method",
	set_payout: "Payout schedule",
	request_spend: "Request spend",
	enrol_smoother: "Smooth income",
};

/**
 * Resolve the server's offered actions against the viewer's capabilities and verification state.
 *
 * The server already gated `quickActions`; this re-applies the capability filter client-side so a
 * dev-seam role flip re-draws the rig without a refetch, and layers the verification lock on top.
 * A `member` who cannot spend is offered `request_spend` in place of the spend actions, so the
 * governance path stays visible rather than the surface simply going quiet.
 */
export function actionsFor(
	offered: readonly WalletAction[],
	caps: readonly VaultCapability[],
	verification: WalletVerification,
	variant: WalletVariant,
): ResolvedAction[] {
	const out: ResolvedAction[] = [];
	for (const action of offered) {
		if (action === "distribute" && variant !== "team") continue;
		if (action === "request_spend") {
			// Only meaningful on a shared vault, and only for someone who cannot already spend.
			if (variant === "personal" || can(caps, "spend")) continue;
			out.push({ action, label: ACTION_LABEL[action], locked: false, prompt: null, href: null });
			continue;
		}
		if (!can(caps, REQUIRES[action])) continue;

		const locked = NEEDS_PAYOUT.has(action) && !verification.canWithdraw;
		out.push({
			action,
			label: ACTION_LABEL[action],
			locked,
			prompt: locked ? verification.prompt : null,
			href: locked ? verification.href : null,
		});
	}
	return out;
}
// #endregion

// #region Lane navigation
/** The eight wallet sections. `key` doubles as the route segment (`""` = the Overview index). */
export type WalletView =
	| "overview"
	| "transactions"
	| "activity"
	| "payouts"
	| "funding"
	| "methods"
	| "invoices"
	| "access";

/** One lane / rail navigation entry. */
export interface LaneItem {
	view: WalletView;
	label: string;
	segment: string;
}

const ALL_ITEMS: readonly LaneItem[] = [
	{ view: "overview", label: "Overview", segment: "" },
	{ view: "transactions", label: "Transactions", segment: "transactions" },
	{ view: "activity", label: "Activity", segment: "activity" },
	{ view: "payouts", label: "Payouts", segment: "payouts" },
	{ view: "funding", label: "Funding", segment: "funding" },
	{ view: "methods", label: "Methods", segment: "methods" },
	{ view: "invoices", label: "Invoices", segment: "invoices" },
	{ view: "access", label: "Access", segment: "access" },
];

/**
 * The lane items a viewer receives. **Absence, not disablement, for navigation:** `Invoices` is a
 * business instrument and `Access` is vault governance, so a personal wallet and a plain member
 * never see them rather than seeing them greyed.
 */
export function laneItemsFor(
	variant: WalletVariant,
	caps: readonly VaultCapability[],
	scope: string,
): LaneItem[] {
	return ALL_ITEMS.filter((item) => {
		if (item.view === "invoices") return variant === "business";
		if (item.view === "access") {
			if (scope === "aggregate" || variant === "personal") return false;
			return can(caps, "manage_members") || can(caps, "manage_billing");
		}
		// The read-only rollup has no money-movement configuration to show.
		if (scope === "aggregate") {
			return item.view === "overview" || item.view === "transactions" || item.view === "activity";
		}
		return true;
	});
}

/** The active view for a pathname (`/wallet` → `overview`). */
export function viewOf(pathname: string): WalletView {
	const seg = pathname.split("/").filter(Boolean)[1] ?? "";
	const found = ALL_ITEMS.find((i) => i.segment === seg);
	return found ? found.view : "overview";
}

/** The href for a view, preserving the active wallet + display currency as query state. */
export function viewHref(view: WalletView, wallet: string, display?: string | null): string {
	const item = ALL_ITEMS.find((i) => i.view === view);
	const base = `/wallet${item && item.segment ? `/${item.segment}` : ""}`;
	const qs = new URLSearchParams();
	if (wallet && wallet !== "personal") qs.set("w", wallet);
	if (display) qs.set("display", display);
	const q = qs.toString();
	return q ? `${base}?${q}` : base;
}
// #endregion
