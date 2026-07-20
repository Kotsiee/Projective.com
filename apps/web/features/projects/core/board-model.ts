import {
	type BoardCard,
	type BoardColumn,
	type BoardView,
	cardColumnId,
	type ProjectParty,
	TICKET_PRIORITY_LABEL,
	type TicketPriority,
	type TicketStatus,
} from "../types/projects-types.ts";

/**
 * board-model — the pure, DOM-free model behind the Kanban board (labels, tones, the card→column
 * placement wrapper, the move classifier that decides which warning modal a drop needs, and the
 * client-side filter/sort). No JSX/signals so SSR, the board island, and the footer rig derive identical
 * results. The column vocabulary + placement live in the Zod SSOT (`@projective/types/projects`); this
 * adds only presentation + the business classification of a move.
 */

// #region Placement
/** Which column a card sits in for the active view (delegates to the shared SSOT rule). */
export function boardCardColumn(
	card: BoardCard,
	view: BoardView,
	kind: "project" | "stage",
): string {
	return cardColumnId(card, view, kind);
}
// #endregion

// #region Labels + tones
/** The full display label for a ticket status (folds nothing — used on the card status chip). */
export function statusLabel(status: TicketStatus): string {
	switch (status) {
		case "backlog":
			return "New";
		case "todo":
			return "Ready";
		case "claimed":
			return "Claimed";
		case "in_progress":
			return "In Progress";
		case "in_review":
			return "Review";
		case "completed":
			return "Completed";
		case "cancelled":
			return "Cancelled";
		case "reported_hidden":
			return "Frozen";
	}
}

/** A `data-tone` key for a ticket status (drives the status chip colour). */
export function statusTone(status: TicketStatus): string {
	switch (status) {
		case "todo":
			return "info";
		case "claimed":
		case "in_progress":
			return "progress";
		case "in_review":
			return "review";
		case "completed":
			return "success";
		case "cancelled":
			return "muted";
		case "reported_hidden":
			return "warning";
		default:
			return "neutral";
	}
}

export function priorityLabel(p: TicketPriority): string {
	return TICKET_PRIORITY_LABEL[p];
}

/** A `data-tone` key for a card priority. */
export function priorityTone(p: TicketPriority): string {
	switch (p) {
		case "urgent":
			return "danger";
		case "high":
			return "warning";
		case "low":
			return "muted";
		default:
			return "neutral";
	}
}
// #endregion

// #region Move classification (which warning a drop needs)
/** The consequence class of a ticket move — drives the confirmation/warning modal (or none). */
export type MoveKind = "free" | "claimed" | "revision";

/**
 * Classify a ticket move for its financial/workflow consequences (PRODUCT_SPEC §Escrow Lifecycle /
 * §Deliverable-Based Workflow, enforced by `move_ticket` / `review_submission`):
 *  - **revision** — moving a ticket into an already-**completed** stage re-opens it as an active
 *    revision ticket for freelancers to claim.
 *  - **claimed** — moving a **claimed** ticket (escrow held from Claim) across stages or into Done
 *    incurs the full stage charge / releases the escrow payout.
 *  - **free** — no claimed freelancer / no escrow consequence; move freely.
 */
export function classifyMove(
	card: BoardCard,
	fromColumnId: string,
	toColumnId: string,
	columns: BoardColumn[],
): MoveKind {
	if (fromColumnId === toColumnId) return "free";
	const to = columns.find((c) => c.id === toColumnId);
	if (!to) return "free";
	if (to.kind === "stage" && to.stageStatus === "completed") return "revision";
	// A claimed ticket incurs the full stage charge / escrow payout when it crosses to a NEW STAGE (the
	// project pipeline) or is confirmed DONE — NOT for ordinary status progression within a stage.
	const toDone = to.kind === "completed" || (to.kind === "status" && to.status === "completed");
	if (card.claimed && (toDone || to.kind === "stage")) return "claimed";
	return "free";
}
// #endregion

// #region Filter + sort options (mirror the /files toolbar controls)
export const PRIORITY_OPTIONS: { value: TicketPriority; label: string }[] = [
	{ value: "urgent", label: "Urgent" },
	{ value: "high", label: "High" },
	{ value: "normal", label: "Normal" },
	{ value: "low", label: "Low" },
];

export const BOARD_SORT_OPTIONS: { value: string; label: string }[] = [
	{ value: "updated", label: "Recent" },
	{ value: "priority", label: "Priority" },
	{ value: "title", label: "Title" },
];

/** MultiSelect options for the assignee filter, de-duplicated by handle. */
export function assigneeOptions(assignees: ProjectParty[]): { value: string; label: string }[] {
	const seen = new Set<string>();
	const out: { value: string; label: string }[] = [];
	for (const a of assignees) {
		const value = a.handle ?? a.name;
		if (seen.has(value)) continue;
		seen.add(value);
		out.push({ value, label: a.name });
	}
	return out;
}

const PRIORITY_RANK: Record<TicketPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** Apply the client-side search + priority + assignee filters (the board loads the full card set). */
export function filterCards(
	cards: BoardCard[],
	filters: { query: string; priorities: string[]; assignees: string[] },
): BoardCard[] {
	const q = filters.query.trim().toLowerCase();
	return cards.filter((c) => {
		if (q && !c.title.toLowerCase().includes(q)) return false;
		if (filters.priorities.length && !filters.priorities.includes(c.priority)) return false;
		if (filters.assignees.length) {
			const handle = c.assignee?.handle ?? c.assignee?.name ?? "";
			if (!filters.assignees.includes(handle)) return false;
		}
		return true;
	});
}

/** Sort cards for display within a column. An empty key keeps the backend/manual order. */
export function sortCards(cards: BoardCard[], key: string, dir: "asc" | "desc"): BoardCard[] {
	if (!key) return cards;
	const sign = dir === "asc" ? 1 : -1;
	const cmp = (a: BoardCard, b: BoardCard): number => {
		if (key === "priority") return sign * (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
		if (key === "title") return sign * a.title.localeCompare(b.title);
		return sign * (Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
	};
	return [...cards].sort(cmp);
}
// #endregion
