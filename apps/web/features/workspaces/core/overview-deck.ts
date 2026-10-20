import {
	canOpenFinance,
	walletHrefFor,
	type WorkspaceDetail,
	workspaceHref,
} from "@projective/types/workspace";
import type { BusinessMoneyBand } from "./overview-model.ts";

/**
 * overview-deck — the Overview's command-center regions as pure functions over the server's
 * {@link WorkspaceDetail}: the telemetry deck, the needs-attention list, the cash-flow source and the
 * region layout (Decision #306).
 *
 * REAL READS ONLY. Every figure is a field the read already carries, gated exactly as the read gated
 * it; a metric the read has no source for is not drawn (no placeholder, no "coming soon"). A team's
 * money exists only where the payout block does (`manage_finances`, Decision #233) — the read's
 * `finance` tiles reach every member, so they are drawn only beside the payout block; a business's
 * only where `businessMoney` answered (`canOpenFinance`, BD18). Nothing here formats money: a figure
 * is minor units in its own currency, drawn by `MoneyView` pinned to that currency. CSS-free and
 * DOM-free, so `deno test` loads it directly.
 */

// #region Telemetry deck
/** An amount in its own currency — never converted, never summed across currencies. */
export interface DeckMoney {
	minor: number;
	currency: string;
}

/** A tile's headline: money, or a figure already in words ("6.5", "Trusted"). */
export type DeckFigure =
	| { type: "money"; money: DeckMoney }
	| { type: "text"; text: string };

/** One middot fact under a tile's headline: words, or words then an amount. */
export interface DeckFact {
	key: string;
	text: string;
	money: DeckMoney | null;
}

/** The workload gauge — a ring whose sweep is never its only channel. */
export interface DeckGauge {
	/** Σ W_i over Σ cap, 0–100, clamped for the ring. */
	percent: number;
	/** The load has reached the combined cap. */
	full: boolean;
	/** The ring's accessible name, stating both figures. */
	label: string;
}

/** The earned Standing rung on the five-rung ladder. */
export interface DeckRung {
	level: number;
	of: number;
}

/** One tile of the deck. */
export interface DeckTile {
	key: string;
	label: string;
	/** `null` when the tile states a fact rather than a figure (an empty wallet). */
	figure: DeckFigure | null;
	/** The words on the figure's line ("available", "of 20 combined cap"). */
	unit: string | null;
	facts: DeckFact[];
	gauge: DeckGauge | null;
	rung: DeckRung | null;
}

/** The rungs of `org.standing_levels` (documentation/database/org/Tables.md). */
export const STANDING_RUNGS = 5;

/** A W_i figure: up to one decimal, a whole number without its `.0`. */
export function formatWi(value: number): string {
	const rounded = Math.round(Math.max(0, value) * 10) / 10;
	return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** `n thing` / `n things`. */
export function plural(n: number, one: string, many = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;

/**
 * When the weekly allowance resets, in UTC — the server's period boundary (Monday 00:00 UTC), stated
 * in the zone it is defined in. Spelled from the UTC fields rather than `Intl`, whose punctuation
 * differs between the server's runtime and the browser, so the server's render and the client's
 * revive print the same words. `null` for an instant that does not parse.
 */
export function resetLabel(iso: string): string | null {
	const at = Date.parse(iso);
	if (!Number.isFinite(at)) return null;
	const d = new Date(at);
	const hh = String(d.getUTCHours()).padStart(2, "0");
	const mm = String(d.getUTCMinutes()).padStart(2, "0");
	return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${hh}:${mm} UTC`;
}

const fact = (key: string, text: string, money: DeckMoney | null = null): DeckFact => ({
	key,
	text,
	money,
});

/**
 * A team's vault — only where the read carried the payout block. Available is the vault wallet's
 * (the payout block's, the figure Payouts distributes from); pending settlement is the same wallet's
 * releases still clearing; escrow held is the entity wallet's locked funds (`finance.locked`).
 */
function vaultTile(detail: WorkspaceDetail): DeckTile | null {
	const payout = detail.payout;
	if (detail.kind !== "team" || !payout) return null;
	const locked = detail.finance.locked;
	return {
		key: "vault",
		label: "Vault",
		figure: { type: "money", money: { minor: payout.availableMinor, currency: payout.currency } },
		unit: "available",
		facts: [
			fact("escrow", "Escrow held", { minor: locked.minor, currency: locked.currency }),
			fact("pending", "Pending settlement", {
				minor: payout.pendingMinor,
				currency: payout.currency,
			}),
		],
		gauge: null,
		rung: null,
	};
}

/**
 * A business's wallet tiles — BB9's figures per wallet currency (Available, then Committed ·
 * Awaiting approval · Spent in 30 days), from the same band `businessMoney` gates; an empty wallet
 * says so rather than printing a zero for a currency it does not hold.
 */
function walletTiles(money: BusinessMoneyBand | null): DeckTile[] {
	if (!money) return [];
	if (money.tiles.length === 0) {
		return [{
			key: "wallet",
			label: "Wallet",
			figure: null,
			unit: null,
			facts: [fact("empty", "Nothing in the wallet yet")],
			gauge: null,
			rung: null,
		}];
	}
	const several = money.tiles.length > 1;
	const own = (m: { minor: number; currency: string }): DeckMoney => ({
		minor: m.minor,
		currency: m.currency,
	});
	return money.tiles.map((tile) => ({
		key: `wallet-${tile.currency}`,
		label: several ? `Wallet · ${tile.currency}` : "Wallet",
		figure: { type: "money", money: own(tile.available) },
		unit: "available",
		facts: [
			fact("committed", "Committed", own(tile.committed)),
			fact("awaiting", "Awaiting approval", own(tile.awaitingApproval)),
			fact("spent", "Spent (30d)", own(tile.spent30d)),
		],
		gauge: null,
		rung: null,
	}));
}

/**
 * A team's workload: the active members' summed W_i against the sum of their own caps. W_i is capped
 * PER PERSON (PRODUCT_SPEC §Resource Allocation → Concurrency Limits), so the denominator is a
 * combined cap, never a team cap, and the members at their own cap are counted beside it.
 */
function workloadTile(detail: WorkspaceDetail): DeckTile | null {
	if (detail.kind !== "team") return null;
	const active = detail.members.filter((m) => m.state === "active");
	if (active.length === 0) return null;
	const load = active.reduce((sum, m) => sum + m.wi, 0);
	const cap = active.reduce((sum, m) => sum + m.wiCap, 0);
	const ratio = cap > 0 ? load / cap : 0;
	const atCap = active.filter((m) => m.wi >= m.wiCap).length;
	const projects = new Set(detail.engagements.map((e) => e.projectSlug)).size;
	return {
		key: "workload",
		label: "Workload",
		figure: { type: "text", text: formatWi(load) },
		unit: `of ${formatWi(cap)} combined cap`,
		facts: [
			fact("engagements", plural(detail.engagements.length, "live engagement")),
			projects > 0 ? fact("projects", plural(projects, "project")) : null,
			atCap > 0 ? fact("at-cap", `${plural(atCap, "member")} at their cap`) : null,
		].filter((f): f is DeckFact => f !== null),
		gauge: {
			percent: Math.min(100, Math.round(ratio * 100)),
			full: cap > 0 && load >= cap,
			label: `Workload: ${formatWi(load)} of ${formatWi(cap)} Wi combined cap`,
		},
		rung: null,
	};
}

/**
 * A team's earned rung — the read's label, on the allowance's 1–5 level when it carried one. A
 * business earns no rung: buyers are not ranked (`org.entity_standing`), so it never has this tile.
 */
function standingTile(detail: WorkspaceDetail): DeckTile | null {
	if (detail.kind !== "team" || !detail.standing) return null;
	const allowance = detail.allowance;
	return {
		key: "standing",
		label: "Standing",
		figure: { type: "text", text: detail.standing },
		unit: allowance ? `rung ${allowance.standingLevel} of ${STANDING_RUNGS}` : null,
		facts: allowance && allowance.standingBonus > 0
			? [fact("bonus", `+${allowance.standingBonus} proposals a week`)]
			: [],
		gauge: null,
		rung: allowance ? { level: allowance.standingLevel, of: STANDING_RUNGS } : null,
	};
}

/** A team's proposal headroom this week, and when it resets (`finance.get_proposal_allowance`). */
function allowanceTile(detail: WorkspaceDetail): DeckTile | null {
	const allowance = detail.allowance;
	if (detail.kind !== "team" || !allowance) return null;
	const resets = resetLabel(allowance.weeklyResetsAt);
	return {
		key: "proposals",
		label: "Proposals",
		figure: { type: "text", text: String(allowance.weeklyRemaining) },
		unit: `of ${allowance.weeklyGranted} left this week`,
		facts: resets ? [fact("resets", `Resets ${resets}`)] : [],
		gauge: null,
		rung: null,
	};
}

/** A business's commissions in delivery, and its proposals still awaiting a reply. */
function projectsTile(detail: WorkspaceDetail): DeckTile | null {
	if (detail.kind !== "business") return null;
	const live = detail.projects.filter((p) => p.state === "active").length;
	const out = detail.projects.filter((p) => p.state === "proposal").length;
	return {
		key: "projects",
		label: "Projects",
		figure: { type: "text", text: String(live) },
		unit: "in delivery",
		facts: out > 0 ? [fact("proposals", `${plural(out, "proposal")} out`)] : [],
		gauge: null,
		rung: null,
	};
}

/**
 * Active members, with the invitations out and the plan's headroom the read answered: a team's seats
 * (members plus pending invitations, against `team_seats`), a business's manager seats.
 */
function membersTile(detail: WorkspaceDetail): DeckTile {
	const active = detail.members.filter((m) => m.state === "active").length;
	const invites = detail.invites.length;
	const facts: DeckFact[] = [];
	if (invites > 0) facts.push(fact("invites", `${plural(invites, "invitation")} out`));
	if (detail.seats && detail.seats.limit !== null) {
		facts.push(fact("seats", `${detail.seats.used} of ${detail.seats.limit} seats`));
	}
	if (detail.managers) {
		const { used, limit } = detail.managers;
		if (limit !== null) facts.push(fact("managers", `${used} of ${limit} manager seats`));
		else if (used > 0) facts.push(fact("managers", plural(used, "manager")));
	}
	return {
		key: "members",
		label: "Members",
		figure: { type: "text", text: String(active) },
		unit: "active",
		facts,
		gauge: null,
		rung: null,
	};
}

/**
 * The deck, money first. A team: Vault (payout block only) · Workload · Standing (once the ladder
 * applies) · Proposals (allowance only) · Members. A business: one Wallet tile per currency (Finance
 * viewers only) · Projects · Members. A tile whose source the read did not carry is absent.
 */
export function telemetryDeck(
	detail: WorkspaceDetail,
	money: BusinessMoneyBand | null,
): DeckTile[] {
	const tiles: (DeckTile | null)[] = detail.kind === "team"
		? [
			vaultTile(detail),
			workloadTile(detail),
			standingTile(detail),
			allowanceTile(detail),
			membersTile(detail),
		]
		: [...walletTiles(money), projectsTile(detail), membersTile(detail)];
	return tiles.filter((t): t is DeckTile => t !== null);
}
// #endregion

// #region Needs attention
/** What an attention item is about — one per module it opens. */
export type AttentionKind = "approvals" | "invites" | "on_hold" | "milestone";

/** One thing waiting on somebody here, as a link to where it is dealt with. */
export interface AttentionItem {
	key: string;
	kind: AttentionKind;
	/** What is waiting, in one line. */
	text: string;
	/** Middot facts under it. */
	meta: string[];
	/** The module or project page it is dealt on. */
	href: string;
	/** The module's name, for the row's trailing fact. */
	module: string;
}

/** How many project rows (on hold, next milestones) each group lists before the Projects module. */
export const ATTENTION_PROJECT_LIMIT = 3;

/**
 * Spend requests the VIEWER may decide: only for a business viewer the read lets decide
 * (`viewerCan.decide` — `approve_spend`, KYB verified), never their own request (nobody decides their
 * own, Decision #239 (e)).
 */
function approvalsItem(detail: WorkspaceDetail): AttentionItem | null {
	if (detail.kind !== "business" || !detail.viewerCan?.decide || !detail.spend) return null;
	const waiting = detail.spend.approvals.pending.filter((r) =>
		r.state === "pending" && r.memberId !== detail.viewerMemberId
	);
	if (waiting.length === 0) return null;
	const first = waiting[0];
	return {
		key: "approvals",
		kind: "approvals",
		text: `${plural(waiting.length, "spend request")} awaiting your decision`,
		meta: [first.name, first.amount.display, first.expiresLabel ?? ""].filter(Boolean),
		href: workspaceHref(detail.kind, detail.handle, "spend"),
		module: "Spend",
	};
}

/** Invitations out, for a viewer who may resend or revoke them (`invite_members`). */
function invitesItem(detail: WorkspaceDetail): AttentionItem | null {
	const count = detail.invites.length;
	if (count === 0 || !detail.viewerCapabilities.includes("invite_members")) return null;
	const names = detail.invites.slice(0, 2).map((i) => i.name || i.email || i.handle).filter(Boolean);
	return {
		key: "invites",
		kind: "invites",
		text: `${plural(count, "invitation")} awaiting an answer`,
		meta: count > names.length ? [...names, `+${count - names.length} more`] : names,
		href: workspaceHref(detail.kind, detail.handle, "invitations"),
		module: "Invitations",
	};
}

/** A team's engagements on an on-hold project, one row per project. */
function onHoldItems(detail: WorkspaceDetail): AttentionItem[] {
	if (detail.kind !== "team") return [];
	const seen = new Set<string>();
	const items: AttentionItem[] = [];
	for (const e of detail.engagements) {
		if (e.projectStatus !== "on_hold" || seen.has(e.projectSlug)) continue;
		seen.add(e.projectSlug);
		items.push({
			key: `hold:${e.projectSlug}`,
			kind: "on_hold",
			text: e.title,
			meta: ["On hold", e.stageTitle].filter(Boolean),
			href: `/projects/${e.projectSlug}`,
			module: "Projects",
		});
	}
	return items.slice(0, ATTENTION_PROJECT_LIMIT);
}

/**
 * Live projects with a next milestone. `due` is the read's pre-formatted date ("20–24 July"), shown
 * as it arrives: it carries no instant, so nothing here can say how near it is.
 */
function milestoneItems(detail: WorkspaceDetail): AttentionItem[] {
	return detail.projects
		.filter((p) => p.state === "active" && p.due)
		.slice(0, ATTENTION_PROJECT_LIMIT)
		.map((p) => ({
			key: `due:${p.id}`,
			kind: "milestone" as const,
			text: p.title,
			meta: [`Next milestone ${p.due}`, p.counterparty].filter(Boolean),
			href: p.href,
			module: "Projects",
		}));
}

/**
 * Everything waiting on somebody here that the read can name, most pressing first: spend requests
 * awaiting the viewer, invitations out, on-hold engagements, next milestones. Each item is gated on
 * the viewer being able to open where it leads. Verification is not listed: the setup hero's step or
 * the verification lock already says it on the same page.
 */
export function attentionItems(detail: WorkspaceDetail): AttentionItem[] {
	return [
		approvalsItem(detail),
		invitesItem(detail),
		...onHoldItems(detail),
		...milestoneItems(detail),
	].filter((item): item is AttentionItem => item !== null);
}
// #endregion

// #region Cash flow
/** The window the Overview's cash flow reads (`GET /api/wallet/activity?range=`). */
export const CASH_FLOW_RANGE = "30d";

/** The window as a phrase, for the chart's accessible name and its hidden table. */
export const CASH_FLOW_PHRASE = "the last 30 days";

/** Where the Overview's cash flow is read from, for a viewer who may see it. */
export interface CashFlowSource {
	/** The `?w=` wallet param — `team:<id>` / `business:<id>`. */
	wallet: string;
	/** The entity wallet, viewed (`/wallet?w=…`). */
	walletHref: string;
}

/**
 * The cash-flow source, or `null` for a viewer who may not see the entity's money: a team's
 * `manage_finances` holders (exactly those the payout block reaches), a business's Finance viewers
 * (`canOpenFinance`, the predicate its money tiles are answered on).
 */
export function cashFlowSource(detail: WorkspaceDetail): CashFlowSource | null {
	const may = detail.kind === "team"
		? detail.payout !== null
		: canOpenFinance("business", detail.viewerCapabilities);
	if (!may) return null;
	return {
		wallet: `${detail.kind}:${detail.id}`,
		walletHref: walletHrefFor(detail.kind, detail.id),
	};
}

/** Whether a flow series moved nothing at all — drawn as a sentence, not a flat chart. */
export function flowIsEmpty(points: readonly { inMinor: number; outMinor: number }[]): boolean {
	return points.every((p) => p.inMinor === 0 && p.outMinor === 0);
}
// #endregion

// #region Layout
/** The regions under the deck. */
export type OverviewRegionKey = "cashflow" | "attention" | "projects" | "activity";

/** One region's place on the twelve-column grid. */
export interface OverviewRegion {
	key: OverviewRegionKey;
	/** Columns taken once the grid is wide enough to have columns. */
	span: 4 | 6 | 8 | 12;
	/** The grid row, from 0 — every row after the first starts on one hairline. */
	row: number;
	/** `end` regions sit beside another, parted by one inline-start hairline. */
	col: "start" | "end";
}

/**
 * The region layout: with cash flow, the chart beside the attention list, then projects beside
 * activity; without it, attention beside projects, then activity across the row.
 */
export function overviewRegions(hasCashFlow: boolean): OverviewRegion[] {
	return hasCashFlow
		? [
			{ key: "cashflow", span: 8, row: 0, col: "start" },
			{ key: "attention", span: 4, row: 0, col: "end" },
			{ key: "projects", span: 6, row: 1, col: "start" },
			{ key: "activity", span: 6, row: 1, col: "end" },
		]
		: [
			{ key: "attention", span: 6, row: 0, col: "start" },
			{ key: "projects", span: 6, row: 0, col: "end" },
			{ key: "activity", span: 12, row: 1, col: "start" },
		];
}
// #endregion
