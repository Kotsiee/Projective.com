import { z } from "zod";
import { ProjectFormat, ProjectPartySchema, ProjectStatus } from "./summary.ts";
import { StageActivity } from "./detail.ts";

/**
 * projects.board — the Zod SSOT for the Kanban board read (`/projects/[projectId]/board`, the
 * project-level pipeline) and the stage-level Tasks board (`/projects/[projectId]/[channelId]/tasks`),
 * plus the ticket-creation payload the 2-panel modal submits.
 *
 * Two board shapes share one contract, discriminated by {@link BoardKind}:
 *  - **project** — columns are `New` (the backlog) + each `[Stage]` + `Completed`; a card (ticket)
 *    flows through the stages. Stage columns can be reordered (workflow sequence); the bookends cannot.
 *  - **stage** — columns are the ticket STATUS lanes; columns are fixed.
 *
 * Board columns map 1:1 to the canonical `ticket_status` enum (root CLAUDE.md §5 · PRODUCT_MANAGEMENT
 * §5.2 — no bespoke statuses). The product board labels `backlog` as **New** and `todo` as **Ready**,
 * folds `claimed` into the **In Progress** column, and treats `cancelled`/`reported_hidden` as card
 * OVERLAYS, never columns (see the {@link TicketStatus} vs {@link TicketColumnStatus} split, and root
 * CLAUDE.md §8 Decision #35 for the display-label reconciliation).
 *
 * Like the sibling projects reads this is a READ projection, not a table row — the fat
 * {@link ProjectBackendService} DERIVES it deterministically from the resolved `ProjectDetail` while
 * `PROJECTS_BACKEND_LIVE` is off; the live path (RLS-scoped `projects.tickets` / `project_stages`,
 * `projects.move_ticket` / `reorder_stages` RPCs) slots in behind the same gate with no shape churn. No
 * DB migration lands with it. Only enum/array/string/number/boolean primitives are used so the schema
 * stays stable across Zod majors (matching the sibling projects schemas).
 */

// #region Ticket status vocabulary (canonical `ticket_status`)
/** The canonical `projects.ticket_status` enum (0007_projects_tables.sql), verbatim. */
export const TicketStatus = z.enum([
	"backlog",
	"todo",
	"claimed",
	"in_progress",
	"in_review",
	"completed",
	"cancelled",
	"reported_hidden",
]);
export type TicketStatus = z.infer<typeof TicketStatus>;

/**
 * The FIVE board columns a stage-level Tasks board renders — the `ticket_status` values that are lanes
 * (0121_kanban_sync.sql mapping: New=backlog · Ready=todo · In Progress=in_progress[+claimed] · Review=
 * in_review · Completed=completed). `cancelled` and `reported_hidden` are card overlays, not columns.
 */
export const TicketColumnStatus = z.enum([
	"backlog",
	"todo",
	"in_progress",
	"in_review",
	"completed",
]);
export type TicketColumnStatus = z.infer<typeof TicketColumnStatus>;

/** The ordered status columns (left → right) for a stage-level board. */
export const TICKET_STATUS_COLUMNS: readonly TicketColumnStatus[] = [
	"backlog",
	"todo",
	"in_progress",
	"in_review",
	"completed",
];

/**
 * Map any `ticket_status` to the board column it belongs in: `claimed` folds into **In Progress**, and
 * the non-column states (`cancelled`/`reported_hidden`) surface in the **New** (backlog) column as an
 * overlay. Pure — shared by the backend fixtures and the feature model (single source of truth).
 */
export function ticketColumnStatus(status: TicketStatus): TicketColumnStatus {
	switch (status) {
		case "todo":
			return "todo";
		case "claimed":
		case "in_progress":
			return "in_progress";
		case "in_review":
			return "in_review";
		case "completed":
			return "completed";
		default:
			return "backlog"; // backlog · cancelled · reported_hidden
	}
}

/** Card urgency — a small derived signal for the card chrome (not a `ticket_status`). */
export const TicketPriority = z.enum(["low", "normal", "high", "urgent"]);
export type TicketPriority = z.infer<typeof TicketPriority>;
// #endregion

// #region Ticket ↔ stage requirement
/** One stage a ticket requires, in the ticket's own order (multi-stage tickets). */
export const TicketStageRefSchema = z.object({
	stageId: z.string().min(1).max(80),
	name: z.string().min(1).max(120),
	/** Order of this stage WITHIN the ticket (0-based). */
	order: z.number().int().min(0),
	/** The stage's lifecycle status (reuses the engagement `project_status` vocabulary, as detail does). */
	status: ProjectStatus,
	/** Whether the stage is required for this ticket (vs optional). */
	required: z.boolean(),
});
export type TicketStageRef = z.infer<typeof TicketStageRefSchema>;
// #endregion

// #region Card (ticket projection)
/** One ticket card on the board. */
export const BoardCardSchema = z.object({
	id: z.string().min(1).max(120),
	title: z.string().min(1).max(200),
	/**
	 * The ticket description. `null`/empty is the PURCHASING GATE: a title-only ticket is a draft
	 * placeholder — visible for planning but not claimable/purchasable until a description exists
	 * (PRODUCT_SPEC §Creation & Purchasing Gate). {@link hasDescription} is the derived gate flag.
	 */
	description: z.string().max(4000).nullable(),
	hasDescription: z.boolean(),
	status: TicketStatus,
	/** The stage the ticket currently sits in (project pipeline board); `null` = the New backlog. */
	stageId: z.string().max(80).nullable(),
	/** The freelancer who claimed it (folds `claimed`/`in_progress`); `null` = unclaimed. */
	assignee: ProjectPartySchema.nullable(),
	/** Whether a freelancer has claimed the ticket — escrow is held from Claim (the financial warning). */
	claimed: z.boolean(),
	/** Whether escrow is currently held for this ticket (moving it into Done releases it). */
	escrowHeld: z.boolean(),
	priority: TicketPriority,
	tags: z.array(z.string().max(40)).max(12),
	/** Pre-formatted price/budget label ("$450") or `null`. */
	budgetLabel: z.string().max(24).nullable(),
	/** The single icon-only activity signal (reuses the {@link StageActivity} vocabulary). */
	activity: StageActivity.nullable().optional(),
	/** `reported_hidden` overlay — a 48h "Frozen" workload-report card, shown striped in New. */
	frozen: z.boolean(),
	commentCount: z.number().int().min(0),
	attachmentCount: z.number().int().min(0),
	checklistDone: z.number().int().min(0),
	checklistTotal: z.number().int().min(0),
	/** The stages this ticket requires, in the ticket's own order (multi-stage). */
	stages: z.array(TicketStageRefSchema),
	updatedAt: z.string(),
	dateLabel: z.string().max(28),
	/** Manual order within the New/backlog column (auto-ordered elsewhere). */
	sortOrder: z.number().int(),
});
export type BoardCard = z.infer<typeof BoardCardSchema>;
// #endregion

// #region Columns
/** Which kind of column this is (drives its header glyph + reorder/create rules). */
export const BoardColumnKind = z.enum(["new", "stage", "completed", "status"]);
export type BoardColumnKind = z.infer<typeof BoardColumnKind>;

/** One board column. */
export const BoardColumnSchema = z.object({
	/** The column id — for a card `move`, the target. Stage columns key off `stage-{id}`. */
	id: z.string().min(1).max(80),
	kind: BoardColumnKind,
	title: z.string().min(1).max(80),
	/** For a `status` column — the ticket status it holds; `null` otherwise. */
	status: TicketColumnStatus.nullable(),
	/** For a `stage` column — the stage id; `null` otherwise. */
	stageId: z.string().max(80).nullable(),
	/** For a `stage` column — the stage's lifecycle status; `null` otherwise. */
	stageStatus: ProjectStatus.nullable(),
	order: z.number().int().min(0),
	/** Whether this column can be dragged to reorder (stage columns only; frozen bookends cannot). */
	reorderable: z.boolean(),
	/**
	 * Whether stage reorder is LOCKED because the stage is started/claimed (PRODUCT_SPEC §Editing &
	 * Reordering Restrictions; `fn_stage_reorder_lock`). A locked stage column shows a lock affordance
	 * and refuses the drag even where `reorderable` would otherwise allow it.
	 */
	locked: z.boolean(),
	/** Whether the client may create a ticket in this column (forbidden on `Completed`). */
	canCreateTicket: z.boolean(),
	/** Whether manual within-column reorder is allowed (only the New/backlog column). */
	sortable: z.boolean(),
	wipLimit: z.number().int().min(0).nullable(),
});
export type BoardColumn = z.infer<typeof BoardColumnSchema>;
// #endregion

// #region Stage reference (modal selector + Stages toggle)
/** A lightweight stage descriptor for the ticket modal's stage selector + the Stages/Status toggle. */
export const BoardStageRefSchema = z.object({
	id: z.string().min(1).max(80),
	name: z.string().min(1).max(120),
	order: z.number().int().min(0),
	status: ProjectStatus,
	/** Whether reordering/starting this stage is locked (started/claimed). */
	locked: z.boolean(),
});
export type BoardStageRef = z.infer<typeof BoardStageRefSchema>;
// #endregion

// #region Board kind / view / scope
/** The project pipeline board (stage or status columns) vs a single stage's Tasks board. */
export const BoardKind = z.enum(["project", "stage"]);
export type BoardKind = z.infer<typeof BoardKind>;

/** The project board's grouping toggle — columns are the Stages, or the ticket Statuses. */
export const BoardView = z.enum(["stages", "statuses"]);
export type BoardView = z.infer<typeof BoardView>;

/** Whether the board is the project-scope pipeline or a channel-scope stage board. */
export const BoardScope = z.enum(["project", "channel"]);
export type BoardScope = z.infer<typeof BoardScope>;
// #endregion

// #region Request params
/** The board query. `channelId` set → the stage-level Tasks board; unset → the project pipeline board. */
export const BoardListParamsSchema = z.object({
	projectId: z.string().min(1).max(120),
	channelId: z.string().min(1).max(120).nullable().optional(),
	/** Project-board grouping (default `stages`); ignored for a stage board. */
	view: BoardView.optional(),
	/** Free-text ticket title match. */
	query: z.string().max(120).optional(),
	/** Filter to a single assignee handle. */
	assignee: z.string().max(80).optional(),
	/** Filter to a single priority. */
	priority: TicketPriority.optional(),
	/** Filter to a single tag. */
	tag: z.string().max(40).optional(),
});
export type BoardListParams = z.infer<typeof BoardListParamsSchema>;
// #endregion

// #region Page envelope
/** The resolved board — columns, cards, the stage list, and the viewer capability flags. */
export const BoardPageSchema = z.object({
	scope: BoardScope,
	kind: BoardKind,
	projectId: z.string().min(1).max(120),
	channelId: z.string().max(120).nullable(),
	format: ProjectFormat,
	/** Pre-resolved board label (e.g. "Pipeline") so SSR + the client render identically. */
	title: z.string().min(1).max(60),
	/** The active grouping (project board). */
	view: BoardView,
	/** Whether the acting user is the client — gates ticket moves, stage reorder + the create actions. */
	viewerIsClient: z.boolean(),
	columns: z.array(BoardColumnSchema),
	cards: z.array(BoardCardSchema),
	/** Every stage of the engagement (for the ticket modal + the Stages toggle). */
	stages: z.array(BoardStageRefSchema),
	/** Members eligible as assignees (the modal + the assignee filter). */
	assignees: z.array(ProjectPartySchema),
	viewerId: z.string().max(80),
	/** Total matched cards (the "N tickets" caption). */
	total: z.number().int().min(0),
});
export type BoardPage = z.infer<typeof BoardPageSchema>;
// #endregion

// #region Ticket creation payload (the 2-panel modal)
/** A per-stage override captured in the modal's right panel for a selected stage. */
export const CreateTicketStageSchema = z.object({
	stageId: z.string().min(1).max(80),
	/** Stage-specific brief / delivery parameters (plain text for now; a rich doc when the editor lands). */
	brief: z.string().max(2000).default(""),
	/** Per-stage price override in cents; `null` = inherit the stage's unit price. */
	unitPriceCents: z.number().int().min(0).nullable().default(null),
});
export type CreateTicketStage = z.infer<typeof CreateTicketStageSchema>;

/**
 * The ticket-creation payload. `title` is the ONLY hard requirement — a title-only ticket is a valid
 * DRAFT placeholder (PRODUCT_SPEC §Creation & Purchasing Gate); the description gate is enforced at
 * purchase/claim, not at create. `stages` carries the client's stage selection + per-stage overrides,
 * in the ticket's chosen order.
 */
export const CreateTicketSchema = z.object({
	projectId: z.string().min(1).max(120),
	title: z.string().min(1, "Name the ticket.").max(200),
	description: z.string().max(4000).default(""),
	priority: TicketPriority.default("normal"),
	tags: z.array(z.string().max(40)).max(12).default([]),
	/** Overall budget in cents; `null` = unset. */
	budgetCents: z.number().int().min(0).nullable().default(null),
	/** Selected stages, in the ticket's order (multi-stage); pre-seeded from the origin stage column. */
	stages: z.array(CreateTicketStageSchema).max(50).default([]),
	/** Which column the ticket is created in (a stage id or the New column); server defaults when "". */
	columnId: z.string().max(80).default(""),
});
export type CreateTicket = z.infer<typeof CreateTicketSchema>;
// #endregion

// #region Column-id conventions + card→column placement (shared by the backend + the feature)
/** The frozen id of the New (backlog) bookend column. */
export const NEW_COLUMN_ID = "new";
/** The frozen id of the Completed bookend column. */
export const COMPLETED_COLUMN_ID = "completed";
/** The id of a stage column on the project pipeline board. */
export const stageColumnId = (stageId: string): string => `stage-${stageId}`;
/** The id of a status column on a status board. */
export const statusColumnId = (status: TicketColumnStatus): string => `status-${status}`;

/**
 * The column a card belongs in — the SINGLE placement rule shared by the backend fixtures and the
 * feature's `getItemColumn`, so the two never drift. On a status board (or the project board's Statuses
 * view) a card sits in its {@link ticketColumnStatus} lane; on the project pipeline (Stages view) a done
 * ticket sits in Completed, a stage-routed ticket in its stage column, and everything else in New.
 */
export function cardColumnId(
	card: { status: TicketStatus; stageId: string | null },
	view: BoardView,
	kind: BoardKind,
): string {
	if (kind === "stage" || view === "statuses") {
		return statusColumnId(ticketColumnStatus(card.status));
	}
	if (card.status === "completed") return COMPLETED_COLUMN_ID;
	return card.stageId ? stageColumnId(card.stageId) : NEW_COLUMN_ID;
}
// #endregion

// #region Display labels (shared)
/** The board-column display label for each status lane — surfaces the New↔backlog / Ready↔todo relabel. */
export const TICKET_COLUMN_LABEL: Record<TicketColumnStatus, string> = {
	backlog: "New",
	todo: "Ready",
	in_progress: "In Progress",
	in_review: "Review",
	completed: "Completed",
};

/** The human label for a card priority. */
export const TICKET_PRIORITY_LABEL: Record<TicketPriority, string> = {
	low: "Low",
	normal: "Normal",
	high: "High",
	urgent: "Urgent",
};
// #endregion

// #region Column builder (shared by the backend fixtures + the feature's view toggle)
/**
 * Build the board's columns from the engagement's stages — the SINGLE source of column structure, so the
 * SSR first paint (backend) and the client's instant Stages/Status toggle (feature) never drift. A
 * `stage` board (or the project board's Statuses view) yields the five status lanes; the project board's
 * Stages view yields `New` + each stage + `Completed`, with each stage column reorderable only while it
 * is not `locked` (started/claimed) and creation forbidden on `Completed`.
 */
export function buildBoardColumns(
	stages: readonly BoardStageRef[],
	view: BoardView,
	kind: BoardKind,
): BoardColumn[] {
	if (kind === "stage" || view === "statuses") {
		return TICKET_STATUS_COLUMNS.map((st, i) => ({
			id: statusColumnId(st),
			kind: "status" as const,
			title: TICKET_COLUMN_LABEL[st],
			status: st,
			stageId: null,
			stageStatus: null,
			order: i,
			reorderable: false,
			locked: false,
			canCreateTicket: st === "backlog",
			sortable: st === "backlog",
			wipLimit: null,
		}));
	}

	const cols: BoardColumn[] = [{
		id: NEW_COLUMN_ID,
		kind: "new",
		title: "New",
		status: null,
		stageId: null,
		stageStatus: null,
		order: 0,
		reorderable: false,
		locked: false,
		canCreateTicket: true,
		sortable: true,
		wipLimit: null,
	}];
	stages.forEach((s, i) =>
		cols.push({
			id: stageColumnId(s.id),
			kind: "stage",
			title: s.name,
			status: null,
			stageId: s.id,
			stageStatus: s.status,
			order: i + 1,
			reorderable: !s.locked,
			locked: s.locked,
			canCreateTicket: true,
			sortable: false,
			wipLimit: null,
		})
	);
	cols.push({
		id: COMPLETED_COLUMN_ID,
		kind: "completed",
		title: "Completed",
		status: null,
		stageId: null,
		stageStatus: null,
		order: stages.length + 1,
		reorderable: false,
		locked: false,
		canCreateTicket: false,
		sortable: false,
		wipLimit: null,
	});
	return cols;
}
// #endregion
