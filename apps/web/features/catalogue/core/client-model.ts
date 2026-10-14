import type {
	ActionReason,
	ClientEngagement,
	ClientKey,
	ClientLane,
	ClientPipeline,
	ClientSummary,
	ConsoleScope,
	ConsoleUrlState,
	EngagementKind,
} from "../types/catalogue-types.ts";
import { ACTION_SEVERITY, LANE_ORDER } from "../types/catalogue-types.ts";

/**
 * client-model — the pure rules under the client pipeline board and the client drawer: lane and
 * reason vocabulary, the board's lanes in order, each row's meta text, roving focus across lanes,
 * where focus lands when the drawer closes, which panel a console URL carries, and the drawer's read
 * path. DOM-free, so every rule is unit-tested.
 *
 * Lanes are the C8 service's derived groupings (`laneOf` over each source's own status); nothing
 * here regroups or re-sorts a buyer, it only lays the service's order out.
 */

// #region Vocabulary
/** Each lane's heading on the board. */
export const LANE_LABELS: Readonly<Record<ClientLane, string>> = {
	action_required: "Needs you",
	active: "Active",
	inquiries: "Inquiries",
	closed: "Closed",
};

/** Why an engagement waits on the seller, as the row's status container reads it. */
export const ACTION_LABELS: Readonly<Record<ActionReason, string>> = {
	dispute_open: "Dispute open",
	revision_requested: "Revision requested",
	reschedule_open: "Reschedule proposed",
	handshake_pending: "Handshake pending",
	submission_pending: "Submission to review",
	inquiry_unanswered: "Unanswered",
};

/** The status container's severity for each reason: money at stake reads as danger. */
export const ACTION_SEVERITY_TONE: Readonly<Record<ActionReason, "danger" | "warning">> = {
	dispute_open: "danger",
	revision_requested: "warning",
	reschedule_open: "warning",
	handshake_pending: "warning",
	submission_pending: "warning",
	inquiry_unanswered: "warning",
};

/** An engagement's kind, as meta text. */
export const ENGAGEMENT_LABELS: Readonly<Record<EngagementKind, string>> = {
	inquiry: "Inquiry",
	quote: "Quote",
	discovery_call: "Discovery call",
	order: "Order",
	session_booking: "Session",
	pipeline_project: "Project",
};

/** Where an engagement's deep link hands off to, as its link text. */
export const HANDOFF_LABELS: Readonly<Record<EngagementKind, string>> = {
	inquiry: "Open thread",
	quote: "Open quote",
	discovery_call: "Open call",
	order: "Open order",
	session_booking: "Open session",
	pipeline_project: "Open project",
};

/** A source status as words: `cancelled_by_client` → `Cancelled by client`. */
export function statusLabel(status: string): string {
	const words = status.replace(/_/g, " ").trim();
	return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}
// #endregion

// #region Board
/** One lane of the board: its buyers in the service's order, and its count. */
export interface BoardLane {
	lane: ClientLane;
	label: string;
	clients: ClientSummary[];
	count: number;
}

/**
 * The board's lanes in urgency order, each holding its buyers in the order the service returned
 * them (severity, then recency). The count is the service's per-lane total, which can exceed the
 * rows shown when the read was cut.
 */
export function boardLanes(pipeline: ClientPipeline): BoardLane[] {
	return LANE_ORDER.map((lane) => ({
		lane,
		label: LANE_LABELS[lane],
		clients: pipeline.clients.filter((c) => c.lane === lane),
		count: pipeline.counts[lane],
	}));
}

/** The most severe reason a buyer waits on the seller, or `null` when nothing is actionable. */
export function primaryReason(summary: ClientSummary): ActionReason | null {
	const reasons = new Set(summary.engagements.flatMap((e) => e.actionReasons));
	return ACTION_SEVERITY.find((r) => reasons.has(r)) ?? null;
}

/**
 * A row's middot meta: the lead engagement's kind, and in console scope the listing it concerns
 * (the workspace is one listing already), plus `+n more` when the buyer has several.
 */
export function rowMeta(summary: ClientSummary, consoleScope: boolean): string[] {
	const lead = summary.engagements[0];
	if (!lead) return [];
	const parts = [ENGAGEMENT_LABELS[lead.kind]];
	if (consoleScope && lead.listingTitle) parts.push(lead.listingTitle);
	if (summary.engagements.length > 1) parts.push(`+${summary.engagements.length - 1} more`);
	return parts;
}

/** The soonest sitting, call or project event ahead among engagements, or `null`. */
export function nextEventAt(engagements: readonly ClientEngagement[]): string | null {
	const ahead = engagements.flatMap((e) => e.nextEventAt ? [e.nextEventAt] : []).sort();
	return ahead[0] ?? null;
}

/** The DOM id of a buyer's row, which the drawer returns focus to. */
export function clientRowId(handle: ClientKey | string): string {
	return `cat-cl-row-${handle.replace(/^@/, "")}`;
}
// #endregion

// #region Roving focus
/** A row's place on the board: lane index, row index within it. */
export interface BoardPos {
	lane: number;
	row: number;
}

/**
 * Where a key moves focus on the board, or `null` when the key is not a board key. ↑/↓ move within
 * a lane (Home/End to its ends); ←/→ move to the nearest lane that has rows, keeping the row index
 * where it can. Lane sizes are row counts; an empty lane is skipped.
 */
export function moveBoardFocus(
	sizes: readonly number[],
	from: BoardPos,
	key: string,
): BoardPos | null {
	const size = sizes[from.lane] ?? 0;
	switch (key) {
		case "ArrowDown":
			return { lane: from.lane, row: Math.min(size - 1, from.row + 1) };
		case "ArrowUp":
			return { lane: from.lane, row: Math.max(0, from.row - 1) };
		case "Home":
			return { lane: from.lane, row: 0 };
		case "End":
			return { lane: from.lane, row: Math.max(0, size - 1) };
		case "ArrowRight":
		case "ArrowLeft": {
			const step = key === "ArrowRight" ? 1 : -1;
			for (let lane = from.lane + step; lane >= 0 && lane < sizes.length; lane += step) {
				if (sizes[lane] > 0) return { lane, row: Math.min(from.row, sizes[lane] - 1) };
			}
			return from;
		}
		default:
			return null;
	}
}

/**
 * The one row that holds `tabIndex=0`: the chosen buyer's row when it is on the board, else the
 * first row of the first lane with rows; `null` on an empty board.
 */
export function rovingStop(lanes: readonly BoardLane[], chosen?: string): BoardPos | null {
	if (chosen) {
		for (let lane = 0; lane < lanes.length; lane++) {
			const row = lanes[lane].clients.findIndex((c) => c.client.handle === chosen);
			if (row >= 0) return { lane, row };
		}
	}
	const lane = lanes.findIndex((l) => l.clients.length > 0);
	return lane >= 0 ? { lane, row: 0 } : null;
}
// #endregion

// #region Drawer
/**
 * Where focus goes when the drawer closes: the row of the buyer it showed when that row is on the
 * board, else the board's first row, else the canvas itself. Ids in, id out, so the island only
 * looks the element up.
 */
export function closeFocusTarget(
	handle: string | undefined,
	rowIds: readonly string[],
	fallback: string,
): string {
	if (handle) {
		const own = clientRowId(handle);
		if (rowIds.includes(own)) return own;
	}
	return rowIds[0] ?? fallback;
}

/** What the console's middle-nav panel holds for a URL: the client drawer, or nothing. */
export function consolePanelOf(url: Pick<ConsoleUrlState, "view" | "client">): "client" | null {
	return url.view === "clients" && url.client ? "client" : null;
}

/** The scope a board or drawer reads: one listing (the workspace), or a console scope. */
export type ClientReadScope = { listing: string } | { filter: ConsoleScope };

/**
 * The query string the Clients reads share for a scope (`?listing=` or `?scope=`), plus the
 * `clientPipeline` dev axis when one is set (honoured only by the fixture path).
 */
export function clientsQuery(scope: ClientReadScope, sim: string | null = null): string {
	const q = new URLSearchParams();
	if ("listing" in scope) q.set("listing", scope.listing);
	else if (scope.filter !== "all") q.set("scope", scope.filter);
	if (sim) q.set("sim", sim);
	const s = q.toString();
	return s ? `?${s}` : "";
}

/** The drawer's read: `/api/catalogue/clients/<handle without @>` plus the scope. */
export function clientDetailPath(
	handle: string,
	scope: ClientReadScope,
	sim: string | null = null,
): string {
	const segment = encodeURIComponent(handle.replace(/^@/, ""));
	return `/api/catalogue/clients/${segment}${clientsQuery(scope, sim)}`;
}

/** The board's read for a scope. */
export function clientPipelinePath(scope: ClientReadScope, sim: string | null = null): string {
	return `/api/catalogue/clients${clientsQuery(scope, sim)}`;
}
// #endregion
