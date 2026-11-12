import {
	type BoardCard,
	type BoardColumn,
	type BoardStageRef,
	type BoardView,
	cardColumnId,
	isSelfClaimable,
	NEW_LANE_REFUSAL_MESSAGE,
	type ProjectParty,
	TICKET_PRIORITY_LABEL,
	type TicketPriority,
	ticketLeavesStage,
	type TicketStatus,
	ticketWorkLocked,
	workColumnLocked,
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

// #region Claim
/**
 * Whether this viewer is offered Claim on a card: a provider seat, onboarded to the card's stage, on a
 * ticket {@link isSelfClaimable} says is open. The server re-checks all of it and adds capacity,
 * funding and payout readiness.
 */
export function viewerCanClaim(
	card: BoardCard,
	stages: readonly BoardStageRef[],
	seatedStageIds: readonly string[],
	isClient: boolean,
): boolean {
	if (isClient || card.frozen || !card.stageId || !seatedStageIds.includes(card.stageId)) {
		return false;
	}
	return isSelfClaimable(card, stages.find((s) => s.id === card.stageId));
}

/**
 * Whether a drop is a claim rather than a move: an unclaimed card landing in the In Progress lane,
 * where `claimed` work is drawn. Only `claim_ticket` sets an assignee, so `move_ticket` there can
 * never succeed (the escrow sync refuses an unassigned hold).
 */
export function isClaimDrop(card: BoardCard, to: BoardColumn): boolean {
	return !card.claimed && to.kind === "status" && to.status === "in_progress";
}
// #endregion

// #region Drop refusal (which columns a dragged card may not enter)
/** Who is dragging, as far as a drop's legality depends on it. */
export interface DropViewer {
	/** A client-side seat (`BoardAccess.isClient`). */
	isClient: boolean;
	/** The project pipeline or a stage's Tasks board. */
	boardKind: "project" | "stage";
}

/** The refusal sentences, shared by the drag highlight and the drop handler's toast. */
export const DROP_REFUSAL = {
	clientOnlyBoard: "Only the client moves tickets on the project board.",
	clientOnlyDone: "Only the client can move a ticket to Done.",
	workLocked: "A freelancer is working this ticket. It can be moved once the work is handed back.",
	claimedToNew: NEW_LANE_REFUSAL_MESSAGE,
	assigneeBacklog: "Only the client moves a claimed ticket back to New.",
	unheld: "Escrow isn't held for this ticket here yet. Fund it before work starts.",
	claimStarts: "A freelancer starts this ticket by claiming it.",
	submitReviews: "Work reaches Review when its freelancer submits it.",
} as const;

/**
 * Why `to` refuses `card` for this viewer, or `null` when the drop is allowed (Decision #421).
 *
 * Mirrors what `projects.move_ticket` and the escrow gate refuse, as far as a card can show it, so the
 * board marks a column locked while the card is in flight instead of answering a refused write after
 * the drop. A drop that is allowed but consequential (a claimed ticket crossing stages, a completed
 * stage re-opened) is not refused here: {@link classifyMove} confirms it. `card.funding` is read as
 * given, so the caller passes the Dev Context Switcher's forced state through it.
 */
export function boardDropRefusal(
	card: BoardCard,
	to: BoardColumn,
	viewer: DropViewer,
): string | null {
	const toDone = to.kind === "completed" || (to.kind === "status" && to.status === "completed");
	if (viewer.boardKind === "project" && !viewer.isClient) return DROP_REFUSAL.clientOnlyBoard;
	if (toDone && !viewer.isClient) return DROP_REFUSAL.clientOnlyDone;
	if (viewer.isClient && ticketWorkLocked(card)) return DROP_REFUSAL.workLocked;
	if (to.kind === "new" && card.stageId !== null && !ticketLeavesStage(card)) {
		return DROP_REFUSAL.claimedToNew;
	}
	if (
		!viewer.isClient && card.claimed && to.kind === "status" && to.status === "backlog"
	) {
		return DROP_REFUSAL.assigneeBacklog;
	}
	if (workColumnLocked(card, columnTarget(card, to).status)) return DROP_REFUSAL.unheld;
	if (card.personal) return null;
	if (viewer.isClient && isClaimDrop(card, to)) return DROP_REFUSAL.claimStarts;
	if (!card.claimed && to.kind === "status" && to.status === "in_review") {
		return DROP_REFUSAL.submitReviews;
	}
	return null;
}
// #endregion

// #region Move target
/**
 * Where a card lands when it is dropped into `col`, as a lifecycle transition rather than a lane.
 *
 * Deliberately narrow: it resolves `status` and `stageId` and NOTHING else. The board used to
 * fabricate `claimed`/`escrowHeld` here — a drag into In Progress asserted that a freelancer had
 * claimed the ticket and that escrow was held for it, which is a financial claim no gesture on this
 * surface is entitled to make. The server's returned card is the authority on both.
 *
 * The New bookend is the stage-less backlog, so a move there sends `stageId: null`, which
 * `projects.move_ticket` reads as "take it out of its stage" (Decision #421).
 */
export function columnTarget(
	card: BoardCard,
	col: BoardColumn,
): { status: TicketStatus; stageId: string | null } {
	if (col.kind === "new") return { status: "backlog", stageId: null };
	if (col.kind === "completed") return { status: "completed", stageId: card.stageId };
	if (col.kind === "stage") {
		return { status: card.claimed ? "in_progress" : "todo", stageId: col.stageId };
	}
	return { status: col.status as TicketStatus, stageId: card.stageId };
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
