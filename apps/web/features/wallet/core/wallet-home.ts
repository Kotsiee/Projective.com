import type {
	DepositRuleView,
	FlowPoint,
	FundState,
	LedgerLine,
	MoneyView,
	PayoutScheduleView,
	SpendApprovalView,
	WalletAction,
	WalletOverview,
	WalletVerification,
} from "../types/wallet-types.ts";
import { FUND_STATE_ORDER, networkFromBrand, networkLabel } from "@projective/types/finance";
import { ACTION_LABEL, isElsewhere } from "./wallet-model.ts";

// #region Actions
/** An offered action as the hero draws it. */
export interface ResolvedAction {
	action: WalletAction;
	label: string;
	/** Drawn but unable to run for this viewer here; pressing it explains why. */
	locked: boolean;
	/** Why a locked action cannot run. */
	reason: string | null;
	/** Where a verification lock is cleared, when that is off this page. */
	fixHref: string | null;
	/**
	 * What the fix link says: "Set up payouts" once identity is not the obstacle (a buyer, or a seller
	 * already verified), else "Finish verification". Null when there is no link.
	 */
	fixLabel: string | null;
}

/** The hero's action row and its overflow menu. */
export interface HeroActions {
	pills: ResolvedAction[];
	more: ResolvedAction[];
}

const PILL_ORDER: readonly WalletAction[] = ["top_up", "transfer", "withdraw", "distribute"];

const NEEDS_PAYOUT: ReadonlySet<WalletAction> = new Set([
	"withdraw",
	"set_payout",
	"enrol_smoother",
]);

/**
 * Resolves an offered action against the two gates that lock rather than hide it: environment
 * unavailability (the server's reason, which wins) and a missing payout-ready identity for money
 * leaving the platform.
 */
export function resolveAction(
	action: WalletAction,
	unavailable: readonly { action: WalletAction; reason: string }[],
	verification: WalletVerification,
): ResolvedAction {
	const blocked = unavailable.find((u) => u.action === action);
	if (blocked) {
		return {
			action,
			label: ACTION_LABEL[action],
			locked: true,
			reason: blocked.reason,
			fixHref: null,
			fixLabel: null,
		};
	}
	const locked = NEEDS_PAYOUT.has(action) && !verification.canWithdraw;
	const fix = locked && isElsewhere(verification.href) ? verification.href : null;
	return {
		action,
		label: ACTION_LABEL[action],
		locked,
		reason: locked
			? verification.prompt ??
				(verification.subject === "client"
					? "Set up a payout account to move money off the platform."
					: "Finish verification to move money off the platform.")
			: null,
		fixHref: fix,
		fixLabel: fix ? (verification.kycStatus === "verified" ? "Set up payouts" : "Finish verification") : null,
	};
}

/**
 * Splits the offered actions into pills (Top up · Transfer · Withdraw · Split) and the More menu. A
 * single overflow action is promoted to its own pill rather than hidden behind a one-item menu.
 */
export function resolveHeroActions(overview: WalletOverview): HeroActions {
	const offered = overview.quickActions;
	const resolve = (a: WalletAction) =>
		resolveAction(a, overview.unavailable, overview.verification);
	const pills = PILL_ORDER.filter((a) => offered.includes(a)).map(resolve);
	const more = offered.filter((a) => !PILL_ORDER.includes(a)).map(resolve);
	if (more.length === 1) return { pills: [...pills, ...more], more: [] };
	return { pills, more };
}

/** Actions that move money and so pass through a review step before committing. */
export const MOVEMENTS: ReadonlySet<WalletAction> = new Set([
	"top_up",
	"withdraw",
	"transfer",
	"distribute",
	"fund_escrow",
]);
// #endregion

// #region Ledger
/** One entry of the ledger feed: a group heading, or a line under it. */
export type LedgerFeedItem =
	| { type: "group"; key: string; label: string }
	| { type: "line"; key: string; line: LedgerLine };

/**
 * Flattens lines into the feed the ledger draws: a heading wherever the server's `group` changes
 * ("Today", "Yesterday", "September 2026"), then the lines under it, in the order the server sent them.
 * The server files each line on the viewer's calendar, so the server render and the hydrated island agree.
 */
export function ledgerFeed(lines: readonly LedgerLine[]): LedgerFeedItem[] {
	const items: LedgerFeedItem[] = [];
	let current: string | null = null;
	for (const line of lines) {
		if (line.group !== current) {
			current = line.group;
			items.push({ type: "group", key: `g:${line.group}:${line.id}`, label: line.group });
		}
		items.push({ type: "line", key: line.id, line });
	}
	return items;
}

/** Appends a newly loaded page, dropping lines already present. */
export function mergeLedger(
	current: readonly LedgerLine[],
	next: readonly LedgerLine[],
): LedgerLine[] {
	const seen = new Set(current.map((l) => l.id));
	return [...current, ...next.filter((l) => !seen.has(l.id))];
}
// #endregion

// #region Upcoming
/** What pressing an upcoming row does. */
export type UpcomingAction =
	| { kind: "action"; action: WalletAction; label: string; stageId?: string }
	| { kind: "approval"; approvalId: string; label: string };

/** The kind of obligation a row represents. */
export type UpcomingKind =
	| "verify"
	| "approval"
	| "bill"
	| "fundable"
	| "release"
	| "escrow"
	| "recurring"
	| "payout"
	| "smoother";

/** One upcoming or scheduled obligation, normalised to a single row shape. */
export interface UpcomingItem {
	id: string;
	kind: UpcomingKind;
	title: string;
	meta: string | null;
	/** The trailing time fact ("Clears in 3 days"). */
	when: string | null;
	amount: MoneyView | null;
	/** A clearing release's progress through its window, `0`–`1`, on the server clock. */
	progress: number | null;
	href: string | null;
	action: UpcomingAction | null;
	/** Needs a look: an overdue bill, a failing rule, an unstarted verification. */
	attention: boolean;
}

/** The reads the Upcoming list is assembled from. */
export interface UpcomingSources {
	overview: WalletOverview;
	rules?: readonly DepositRuleView[] | null;
	schedule?: PayoutScheduleView | null;
	approvals?: readonly SpendApprovalView[] | null;
	canDecide?: boolean;
}

const MODE_LABEL: Readonly<Record<PayoutScheduleView["mode"], string>> = {
	manual: "Manual",
	scheduled_weekly: "Weekly",
	scheduled_monthly: "Monthly",
	threshold: "Threshold",
};

/**
 * Assembles obligations, most urgent first: what needs the viewer, then money on its way in, then
 * standing arrangements. A row carries an action only when the server offered it.
 */
export function upcomingItems(src: UpcomingSources): UpcomingItem[] {
	const { overview } = src;
	const offered = new Set(overview.quickActions);
	const offer = (action: WalletAction, label: string, stageId?: string): UpcomingAction | null =>
		offered.has(action) ? { kind: "action", action, label, stageId } : null;
	const items: UpcomingItem[] = [];

	const v = overview.verification;
	if (v.prompt) {
		items.push({
			id: "verify",
			kind: "verify",
			title: v.prompt,
			meta: v.subject === "business" ? "Business verification" : "Identity verification",
			when: v.kycStatus === "pending" ? "In review" : null,
			amount: null,
			progress: null,
			href: isElsewhere(v.href) ? v.href : null,
			action: v.kycStatus === "verified" && !v.payoutReady ? offer("add_method", "Add") : null,
			attention: v.kycStatus !== "pending",
		});
	}

	for (const ap of src.approvals ?? []) {
		if (ap.status !== "pending") continue;
		items.push({
			id: `approval-${ap.id}`,
			kind: "approval",
			title: `Spend request from ${ap.requesterName}`,
			meta: ap.reason || null,
			when: ap.dateLabel,
			amount: ap.amount,
			progress: null,
			href: null,
			action: src.canDecide ? { kind: "approval", approvalId: ap.id, label: "Review" } : null,
			attention: false,
		});
	}

	const business = overview.business;
	if (business && business.invoicesDue > 0) {
		items.push({
			id: "bills",
			kind: "bill",
			title: business.invoicesDue === 1 ? "1 invoice due" : `${business.invoicesDue} invoices due`,
			meta: "Issued to this business",
			when: null,
			amount: business.invoicesDueAmount,
			progress: null,
			href: null,
			action: null,
			attention: true,
		});
	}
	for (const stage of business?.fundable ?? []) {
		items.push({
			id: `fundable-${stage.stageId}`,
			kind: "fundable",
			title: `${stage.stageName} is waiting for escrow`,
			meta: `${stage.projectTitle} · ${stage.ticketCount} ${
				stage.ticketCount === 1 ? "ticket" : "tickets"
			}`,
			when: null,
			amount: stage.amount,
			progress: null,
			href: `/projects/${stage.projectId}`,
			action: offer("fund_escrow", "Fund", stage.stageId),
			attention: false,
		});
	}

	for (const item of overview.incoming) {
		const release = item.kind === "pending_release";
		items.push({
			id: item.id,
			kind: release ? "release" : "escrow",
			title: item.label,
			meta: release ? "7-day safety window" : "In escrow · released when the work is approved",
			when: item.clearingLabel,
			amount: item.amount,
			progress: release ? item.clearingFraction : null,
			href: isElsewhere(item.href) ? item.href : null,
			action: null,
			attention: false,
		});
	}

	for (const rule of src.rules ?? []) {
		if (!rule.active && !rule.failureNote) continue;
		items.push({
			id: `rule-${rule.id}`,
			kind: "recurring",
			title: rule.interval === "weekly" ? "Weekly top-up" : "Monthly top-up",
			meta: rule.failureNote ?? (rule.sourceLabel ? `From ${rule.sourceLabel}` : null),
			when: rule.active ? rule.nextRunLabel : "Paused",
			amount: rule.amount,
			progress: null,
			href: null,
			action: null,
			attention: rule.failureNote !== null,
		});
	}

	const schedule = src.schedule;
	if (schedule && schedule.mode !== "manual") {
		items.push({
			id: "payout-schedule",
			kind: "payout",
			title: `${MODE_LABEL[schedule.mode]} payout`,
			meta: schedule.destinationLabel ? `To ${schedule.destinationLabel}` : null,
			when: schedule.nextRunLabel,
			amount: schedule.mode === "threshold" ? schedule.threshold : null,
			progress: null,
			href: null,
			action: offer("set_payout", "Change"),
			attention: false,
		});
	}

	const smoother = overview.personal?.incomeSmoother;
	if (smoother?.status === "enrolled") {
		items.push({
			id: "smoother",
			kind: "smoother",
			title: "Income Smoother",
			meta: "Paid out as a steady monthly figure",
			when: "Monthly",
			amount: smoother.projected ?? smoother.targetMonthly,
			progress: null,
			href: null,
			action: null,
			attention: false,
		});
	} else if (smoother?.status === "eligible") {
		items.push({
			id: "smoother",
			kind: "smoother",
			title: "Smooth your income",
			meta: "Eligible for a steady monthly payout",
			when: null,
			amount: null,
			progress: null,
			href: null,
			action: offer("enrol_smoother", "Set up"),
			attention: false,
		});
	}

	return items;
}
// #endregion

// #region Flow geometry
/** One flow-chart bucket as display ratios of the busiest bucket. */
export interface FlowBar {
	label: string;
	inRatio: number;
	outRatio: number;
}

/**
 * Scales money in and out against one shared peak so both sides compare by eye; an empty window
 * yields zero ratios. Geometry only — no figure is derived from it.
 */
export function flowBars(points: readonly FlowPoint[]): FlowBar[] {
	const peak = points.reduce((max, p) => Math.max(max, p.inMinor, p.outMinor), 0);
	return points.map((p) => ({
		label: p.label,
		inRatio: peak > 0 ? p.inMinor / peak : 0,
		outRatio: peak > 0 ? p.outMinor / peak : 0,
	}));
}
// #endregion

// #region Fund allocation
/** The sentence each fund state carries, specific to this wallet's stages and cases. */
export function fundStateHint(state: FundState, overview: WalletOverview): string {
	switch (state) {
		case "available":
			return "Spendable now";
		case "locked": {
			const stages = overview.lockedStageCount;
			return stages > 0
				? `Held on ${stages} active ${stages === 1 ? "stage" : "stages"} until the work is approved`
				: "Held in escrow until work is approved";
		}
		case "pending":
			return "Released, finishing the 7-day safety window";
		case "on_hold": {
			const cases = overview.heldCaseCount;
			return cases > 0
				? `Reserved while ${cases} ${cases === 1 ? "case is" : "cases are"} reviewed`
				: "Reserved until a review closes";
		}
	}
}

/**
 * The states in order of how soon the money can be spent — the SSOT's {@link FUND_STATE_ORDER}, which
 * the server's allocation slices follow, so the hero's figures and the meter read the same way.
 */
export const ALLOCATION_ORDER: readonly FundState[] = FUND_STATE_ORDER;
// #endregion

// #region Payment methods
/** The fields a saved method is named from. */
export interface NamedMethod {
	label: string | null;
	brand: string | null;
	provider?: string | null;
	last4: string | null;
}

/**
 * How a saved method is named wherever it is listed: an owner-given label, else the card network as
 * people write it ("Visa", "American Express" — Stripe reports `visa`, `amex`), else the provider; with
 * the last four digits appended once. One rule for the Payment methods list and every card picker, so
 * the same card is never called two things on one page.
 */
export function methodName(m: NamedMethod): string {
	const network = m.brand ? networkFromBrand(m.brand) : null;
	const brand = network && network !== "unknown"
		? networkLabel(network)
		: m.brand
		? m.brand[0].toUpperCase() + m.brand.slice(1)
		: null;
	const base = m.label ?? brand ?? m.provider ?? "Payment method";
	return m.last4 && !base.includes(m.last4) ? `${base} ·· ${m.last4}` : base;
}
// #endregion
