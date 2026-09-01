import { z } from "zod";
import { ContextType } from "../auth/mod.ts";
import { ProjectFormat, ProjectPartySchema, ProjectStatus } from "./summary.ts";
import { StageActivity } from "./detail.ts";
import { FileItemSchema } from "./files.ts";
import { SubmissionTreeNodeSchema } from "./submissions.ts";

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

// #region Workload intensity (the Architect's Override)
/**
 * The client-set **Difficulty Multiplier** (PRODUCT_SPEC §The Weighting Engine) — the only half of
 * Workload Intensity a human chooses. The other half, the stage's CREATE-category baseline weight,
 * is a property of the work itself and arrives on {@link BoardStageRef.categoryWeight}.
 *
 * $W_{ticket} = \text{CategoryWeight} \times \text{DifficultyMultiplier}$, and the ticket's money
 * scales on the same axis — which is why this control replaced the free-text budget field: a client
 * declares how hard the work is, and the price follows from the stage's own rate.
 */
export const TicketIntensity = z.enum(["low", "standard", "high"]);
export type TicketIntensity = z.infer<typeof TicketIntensity>;

/** The multipliers, verbatim from PRODUCT_SPEC §The Architect's Override. */
export const INTENSITY_MULTIPLIER: Record<TicketIntensity, number> = {
	low: 0.5,
	standard: 1,
	high: 2,
};

/** Human labels for the three multipliers. */
export const TICKET_INTENSITY_LABEL: Record<TicketIntensity, string> = {
	low: "Low",
	standard: "Standard",
	high: "High",
};

/**
 * A one-line explanation of what picking this multiplier commits the client to — shown beside the
 * control, because the choice moves both the freelancer's capacity ledger and the ticket's price.
 */
export const TICKET_INTENSITY_HINT: Record<TicketIntensity, string> = {
	low: "A quick pass. Half a standard unit of a freelancer's capacity, at half the stage rate.",
	standard: "The stage's normal unit of work, at its listed rate.",
	high: "Demanding work. Two units of capacity, at twice the stage rate.",
};

/** The derived $W_i$ a ticket consumes in one stage — the figure the capacity caps are summed on. */
export function workloadIntensity(categoryWeight: number, intensity: TicketIntensity): number {
	return Math.round(categoryWeight * INTENSITY_MULTIPLIER[intensity] * 100) / 100;
}

/**
 * What one stage of a ticket costs: the stage's per-ticket unit price scaled by the difficulty
 * multiplier. `null` unit price (a stage that has not priced its tickets) yields `null`, never 0 —
 * an unknown price and a free stage are different facts and the footer must not conflate them.
 */
export function stageCostCents(
	unitPriceCents: number | null,
	intensity: TicketIntensity,
): number | null {
	if (unitPriceCents === null) return null;
	return Math.round(unitPriceCents * INTENSITY_MULTIPLIER[intensity]);
}

/** Format minor units as a plain money string (`$1,240`, `$99.50` when the cents are significant). */
export function formatTicketMoney(cents: number, currency = "USD"): string {
	const whole = cents % 100 === 0;
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency,
		minimumFractionDigits: whole ? 0 : 2,
		maximumFractionDigits: whole ? 0 : 2,
	}).format(cents / 100);
}
// #endregion

// #region Ticket contents (task list · attachments · audit log)
/**
 * One line on a ticket's (or a stage's) task list.
 *
 * A task list is STRUCTURAL: the client writes it, orders it and owns it, because it is part of what
 * the ticket asks for. Completion, though, is a delivery claim, so it is never made from the ticket
 * surface — a step is ticked off at the SUBMISSION level, where the work that satisfies it is
 * attached and reviewable. {@link done} is therefore read-only wherever a ticket is read or composed.
 */
export const TicketTaskSchema = z.object({
	id: z.string().min(1).max(80),
	text: z.string().min(1).max(240),
	done: z.boolean(),
	/**
	 * Who ticked this step off, in the order they did.
	 *
	 * Plural because a step can be satisfied by more than one submission — two freelancers working a
	 * band in parallel both contribute to the same line. Carried on the task rather than looked up
	 * from the submission log so the checklist can render the faces beside the step without the
	 * reader leaving for another tab, and so a step whose submission was later reorganised still
	 * records who did it.
	 */
	completedBy: z.array(ProjectPartySchema).max(8).default([]),
});
export type TicketTask = z.infer<typeof TicketTaskSchema>;

/** What a {@link TicketHistoryEntry} records — drives its glyph and tone. */
export const TicketHistoryKind = z.enum([
	"created",
	"status",
	"stage",
	"assigned",
	"edited",
	"attachment",
	"submission",
	"intensity",
	"priority",
	"due",
]);
export type TicketHistoryKind = z.infer<typeof TicketHistoryKind>;

/** One entry in the ticket's chronological audit log (`projects.ticket_history`). */
export const TicketHistoryEntrySchema = z.object({
	id: z.string().min(1).max(80),
	kind: TicketHistoryKind,
	/** Who acted; `null` for a system transition. */
	actor: ProjectPartySchema.nullable(),
	/** The headline — "Moved to Review", "Raised intensity to High". */
	summary: z.string().min(1).max(200),
	/** Optional supporting line (the diff, the reason). */
	detail: z.string().max(400).nullable(),
	at: z.string(),
	dateLabel: z.string().max(28),
	/**
	 * Whether the acting viewer has not yet seen this event. Drives the footer's unread counter and
	 * the History rail's marker — a per-viewer fact, so it is resolved server-side rather than
	 * inferred from a timestamp the client would have to compare against a clock it does not own.
	 */
	unread: z.boolean().default(false),
	/**
	 * The tree path this event points at, when following it means going somewhere. A `submission`
	 * event carries its unit's path so clicking the entry can open the Submissions tab AT that unit;
	 * an event with nowhere to go carries `[]`.
	 */
	targetPath: z.array(z.string().max(120)).max(12).default([]),
});
export type TicketHistoryEntry = z.infer<typeof TicketHistoryEntrySchema>;

/**
 * The files delivered under one node of a ticket's submission tree, keyed by that node's segment
 * path. An array of `{path, files}` rather than a keyed record, so the schema stays on the
 * primitive-only footing the sibling projects schemas hold to.
 */
export const TicketSubmissionFilesSchema = z.object({
	path: z.array(z.string().max(120)),
	files: z.array(FileItemSchema),
});
export type TicketSubmissionFiles = z.infer<typeof TicketSubmissionFilesSchema>;
// #endregion

// #region Ticket finance (the itemised money trail)
/**
 * What one line of a ticket's money trail records. These are the movements the escrow engine
 * actually performs (PRODUCT_SPEC §Escrow Lifecycle · `finance.escrows`/`transactions`), not a
 * presentation vocabulary: `hold` when a claim locks the client's funds, `release` when an accepted
 * submission pays the freelancer, `fee` the platform's 5% cut, `refund` a returned hold, and
 * `adjustment` an intensity or scope change that re-prices an existing hold.
 */
export const TicketPaymentKind = z.enum(["hold", "release", "fee", "refund", "adjustment"]);
export type TicketPaymentKind = z.infer<typeof TicketPaymentKind>;

/** Where a movement has got to. `held` funds are committed but not yet anybody's. */
export const TicketPaymentState = z.enum(["pending", "held", "settled", "failed"]);
export type TicketPaymentState = z.infer<typeof TicketPaymentState>;

/** One row of the Finances tab's transaction/payment audit history. */
export const TicketPaymentEntrySchema = z.object({
	id: z.string().min(1).max(80),
	kind: TicketPaymentKind,
	state: TicketPaymentState,
	/** The movement in words — "Escrow held on claim", "Platform fee". */
	label: z.string().min(1).max(160),
	/** Signed minor units: positive into escrow / the freelancer, negative back out. */
	amountCents: z.number().int(),
	/** The stage this movement belongs to, when it is stage-scoped; `null` for ticket-level rows. */
	stageId: z.string().max(80).nullable(),
	/** The counterparty, when a person is on the other end of it. */
	party: ProjectPartySchema.nullable(),
	at: z.string(),
	dateLabel: z.string().max(28),
});
export type TicketPaymentEntry = z.infer<typeof TicketPaymentEntrySchema>;
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
	/** The stage-specific brief for THIS ticket (what this stage must deliver). */
	brief: z.string().max(2000).default(""),
	/** Per-stage difficulty override; falls back to the ticket's own when unset at capture time. */
	intensity: TicketIntensity.default("standard"),
	/** The stage-scoped task list for this ticket. */
	tasks: z.array(TicketTaskSchema).max(60).default([]),
	/**
	 * Whether this stage runs SIMULTANEOUSLY with the one before it in the ticket's order — the
	 * concurrency configuration the composer's pipeline sets. A run of stages linked this way forms
	 * one execution band that starts together rather than in sequence.
	 */
	parallel: z.boolean().default(false),
	/** The resolved cost of this stage for this ticket, in minor units; `null` = the stage is unpriced. */
	costCents: z.number().int().min(0).nullable().default(null),
	/**
	 * The stage's per-ticket BASE rate at capture time, in minor units; `null` = unpriced.
	 *
	 * Carried on the ticket rather than looked up from the live stage, because the Finances tab has
	 * to show the arithmetic — base rate, the multiplier the client chose, the resulting cost — and a
	 * later change to the stage's rate must not silently restate what an existing ticket was priced
	 * at. {@link costCents} is always `stageCostCents(unitPriceCents, intensity)` at capture.
	 */
	unitPriceCents: z.number().int().min(0).nullable().default(null),
});
export type TicketStageRef = z.infer<typeof TicketStageRefSchema>;

/**
 * Group an ordered stage list into execution BANDS: each band is a set of stages that start
 * together, and the bands themselves run in sequence. A stage marked {@link TicketStageRef.parallel}
 * joins the band before it; the first stage always opens a band regardless of its own flag (there is
 * nothing before it to be simultaneous with), which is what keeps a reorder from producing a
 * dangling continuation.
 */
export function executionBands<T extends { parallel: boolean }>(stages: readonly T[]): T[][] {
	const bands: T[][] = [];
	stages.forEach((stage, i) => {
		if (i === 0 || !stage.parallel) bands.push([stage]);
		else bands[bands.length - 1].push(stage);
	});
	return bands;
}

/**
 * The ticket's total cost — the sum of every selected stage's resolved cost. Returns `null` when no
 * selected stage carries a price, so an unpriced pipeline reads as "not yet priced" rather than free.
 */
export function ticketTotalCents(
	stages: readonly { costCents: number | null }[],
): number | null {
	let total = 0;
	let priced = false;
	for (const s of stages) {
		if (s.costCents === null) continue;
		priced = true;
		total += s.costCents;
	}
	return priced ? total : null;
}

/**
 * Whether a workspace has colleagues to assign work between. `personal` is one buyer; every other
 * context type is a multi-seat client, which is the condition the ticket-owner selector exists for.
 */
export function isSharedWorkspace(kind: ContextType): boolean {
	return kind !== "personal";
}
// #endregion

// #region Finance derivation (the itemised breakdown)
/** One priced line of a ticket: the stage, its base rate, the chosen multiplier, and the result. */
export interface TicketCostLine {
	stageId: string;
	name: string;
	order: number;
	intensity: TicketIntensity;
	/** The multiplier the intensity resolves to — shown as arithmetic, never as a badge label. */
	multiplier: number;
	/** The stage's base per-ticket rate at capture; `null` = the stage was never priced. */
	baseCents: number | null;
	/** `baseCents × multiplier`, or `null` when the stage is unpriced. */
	costCents: number | null;
}

/**
 * The Finances tab's line items, in the ticket's own execution order.
 *
 * Re-derives `costCents` from the captured base rate and the captured intensity rather than trusting
 * the stored figure — the breakdown's job is to SHOW the arithmetic, so it must be the arithmetic. A
 * stage that has a stored cost but no captured base rate (an older ticket) falls back to the stored
 * figure, because a blank line would be a worse answer than an unexplained one.
 */
export function ticketCostLines(
	stages: readonly TicketStageRef[],
): TicketCostLine[] {
	return [...stages]
		.sort((a, b) => a.order - b.order)
		.map((s) => ({
			stageId: s.stageId,
			name: s.name,
			order: s.order,
			intensity: s.intensity,
			multiplier: INTENSITY_MULTIPLIER[s.intensity],
			baseCents: s.unitPriceCents,
			costCents: s.unitPriceCents === null
				? s.costCents
				: stageCostCents(s.unitPriceCents, s.intensity),
		}));
}

/**
 * How much of a ticket's price has actually been SPENT — money that has left the client for good.
 *
 * Deliberately narrower than "money committed": a `held` escrow is the client's own funds ring-fenced
 * against work not yet accepted, and counting it as spent would tell a client they had paid for a
 * delivery nobody has approved. So only `settled` movements count, and only the two kinds that leave:
 * a `release` to the freelancer and the platform `fee`. A settled `refund` (a negative amount) nets
 * back out on its own sign.
 *
 * Returns `0` for a ticket nothing has moved on, which is the true answer — unlike a price, a spend
 * of nothing and an unknown spend are not different facts.
 */
export function ticketSpentCents(payments: readonly TicketPaymentEntry[]): number {
	let spent = 0;
	for (const p of payments) {
		if (p.state !== "settled") continue;
		if (p.kind === "release" || p.kind === "fee") spent += Math.abs(p.amountCents);
		else if (p.kind === "refund") spent -= Math.abs(p.amountCents);
	}
	return Math.max(0, spent);
}
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
	/**
	 * The CLIENT-side member accountable for this ticket inside a multi-member workspace — the person
	 * who briefs it, answers questions about it and reviews what comes back.
	 *
	 * Distinct from {@link assignee}, which is the provider-side freelancer who claimed the work. On a
	 * personally-owned project the two sides are one person and this is always `null`: the control
	 * only exists where "which of us owns this" is a real question ({@link BoardPage.workspaceKind}).
	 */
	owner: ProjectPartySchema.nullable().default(null),
	/**
	 * Everyone who has touched this ticket — the client who wrote it, the freelancers who claimed or
	 * submitted against it, the reviewer who accepted it. Derived from the audit log rather than from
	 * membership, so the header's cascade answers "who has actually been involved" and not "who could
	 * be".
	 */
	contributors: z.array(ProjectPartySchema).max(24).default([]),
	/** Whether a freelancer has claimed the ticket — escrow is held from Claim (the financial warning). */
	claimed: z.boolean(),
	/** Whether escrow is currently held for this ticket (moving it into Done releases it). */
	escrowHeld: z.boolean(),
	priority: TicketPriority,
	/** The client's difficulty multiplier — the ticket's own default for every stage it touches. */
	intensity: TicketIntensity,
	/** The summed $W_i$ this ticket consumes across its stages (capacity, not money). */
	workload: z.number().min(0),
	/** ISO due date, or `null` when the ticket is undated. */
	dueDate: z.string().max(40).nullable(),
	/** Pre-formatted due label ("Aug 4") or `null` — server-formatted so SSR and the island agree. */
	dueLabel: z.string().max(28).nullable(),
	/**
	 * The ticket's total cost in minor units — the SUM of its stages' resolved costs, never a typed
	 * figure. `null` when no selected stage carries a price.
	 */
	budgetCents: z.number().int().min(0).nullable(),
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
	/** The ticket-level task list (the stage-scoped ones live on each {@link TicketStageRef}). */
	tasks: z.array(TicketTaskSchema).max(60).default([]),
	/**
	 * Files attached to the ticket. Reuses the discovery {@link FileItemSchema} verbatim rather than
	 * forking a second file shape, so the detail modal mounts the SAME `/files` card + table
	 * components the explorer does.
	 */
	attachments: z.array(FileItemSchema).default([]),
	/** The chronological audit log (newest first), for the detail modal's History tab. */
	history: z.array(TicketHistoryEntrySchema).default([]),
	/**
	 * The deliverable hierarchy submitted against this ticket. Reuses the Submissions explorer's own
	 * {@link SubmissionTreeNodeSchema}, so the detail modal mounts the SAME tree and card components
	 * `/projects/[id]/submissions` does rather than a second, divergent renderer.
	 */
	submissions: z.array(SubmissionTreeNodeSchema).default([]),
	/** Files under each submission node, addressed by that node's segment path. */
	submissionFiles: z.array(TicketSubmissionFilesSchema).default([]),
	/** The ticket's money trail — every escrow movement, fee and adjustment, newest first. */
	payments: z.array(TicketPaymentEntrySchema).default([]),
	/**
	 * How many audit-log events the acting viewer has not seen. A count, not a dot, because this one
	 * is a footer METRIC the viewer clicks to go read them — the dot-not-count rule (DESIGN_SYSTEM
	 * Part D) governs ambient nav signals, not a quantity that is itself the thing being reported.
	 */
	unreadCount: z.number().int().min(0).default(0),
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
/** How work is routed to freelancers within a stage (`projects.assignment_routing_mode`). */
export const StageAssignmentMode = z.enum([
	"open_pull",
	"round_robin",
	"manual",
	"parallel_stream",
]);
export type StageAssignmentMode = z.infer<typeof StageAssignmentMode>;

/** Human labels for the four routing modes (PRODUCT_SPEC §Assignment Modes). */
export const ASSIGNMENT_MODE_LABEL: Record<StageAssignmentMode, string> = {
	open_pull: "Open pull",
	round_robin: "Round robin",
	manual: "Manual assignment",
	parallel_stream: "Parallel stream",
};

/**
 * The stage descriptor the ticket composer's pipeline renders and prices against. Richer than the
 * old name-only shape because every fact the composer shows about a stage — its rate, its roster,
 * its live load, its routing — is the client's evidence for the two decisions the modal asks of
 * them: which stages this ticket needs, and how hard the work is.
 */
export const BoardStageRefSchema = z.object({
	id: z.string().min(1).max(80),
	name: z.string().min(1).max(120),
	order: z.number().int().min(0),
	status: ProjectStatus,
	/** Whether reordering/starting this stage is locked (started/claimed). */
	locked: z.boolean(),
	/** The stage's own brief (`project_stages.description_text`) — shown truncated on the card. */
	description: z.string().max(2000),
	/** The stage's per-ticket unit price in minor units; `null` = unpriced. */
	unitPriceCents: z.number().int().min(0).nullable(),
	/** The CREATE-category baseline weight this stage's work carries (PRODUCT_SPEC §Baseline Weights). */
	categoryWeight: z.number().min(0).max(10),
	/** The freelancers assigned to this stage — the composer's cascading avatar stack. */
	members: z.array(ProjectPartySchema).max(50),
	/** Live ticket count already routed through this stage (the inspector's load figure). */
	ticketCount: z.number().int().min(0),
	/** How the stage routes work to its roster. */
	assignmentMode: StageAssignmentMode,
	/** The Project Hard Cap on summed $W_i$ per freelancer in this stage; `null` = unlimited. */
	maxConcurrentIntensity: z.number().min(0).nullable(),
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
	/**
	 * Which workspace owns the engagement on the CLIENT side. `personal` means one buyer with no
	 * colleagues, and is the reason the ticket's owner selector is absent there rather than empty:
	 * a dropdown offering a single choice is a control that cannot be used.
	 */
	workspaceKind: ContextType.default("personal"),
	/** That workspace's human name ("Northwind Studio") — the selector's group label. */
	workspaceLabel: z.string().max(120).default("Personal"),
	/**
	 * The client-side members a ticket can be assigned to inside a team/business/organisation. Empty
	 * on a personal engagement.
	 */
	clientMembers: z.array(ProjectPartySchema).max(60).default([]),
	viewerId: z.string().max(80),
	/** Total matched cards (the "N tickets" caption). */
	total: z.number().int().min(0),
});
export type BoardPage = z.infer<typeof BoardPageSchema>;
// #endregion

// #region Ticket creation payload (the composer)
/** A per-stage configuration captured in the composer's stage inspector. */
export const CreateTicketStageSchema = z.object({
	stageId: z.string().min(1).max(80),
	/** Stage-specific brief / delivery parameters (plain text for now; a rich doc when the editor lands). */
	brief: z.string().max(2000).default(""),
	/** The difficulty multiplier for THIS stage — the only price lever, replacing the old override field. */
	intensity: TicketIntensity.default("standard"),
	/** The stage-scoped task list. */
	tasks: z.array(TicketTaskSchema).max(60).default([]),
	/** Whether this stage starts simultaneously with the stage before it in the ticket's order. */
	parallel: z.boolean().default(false),
});
export type CreateTicketStage = z.infer<typeof CreateTicketStageSchema>;

/**
 * The ticket-creation payload. `title` is the ONLY hard requirement — a title-only ticket is a valid
 * DRAFT placeholder (PRODUCT_SPEC §Creation & Purchasing Gate); the description gate is enforced at
 * purchase/claim, not at create. `stages` carries the client's stage selection, per-stage briefs,
 * intensities and task lists, in the ticket's chosen order.
 *
 * There is deliberately NO budget field. A ticket's price is the sum of its stages' rates scaled by
 * their difficulty multipliers — a number the client composes by choosing work, not by typing one.
 */
export const CreateTicketSchema = z.object({
	projectId: z.string().min(1).max(120),
	title: z.string().min(1, "Name the ticket.").max(200),
	description: z.string().max(4000).default(""),
	priority: TicketPriority.default("normal"),
	/** The ticket-level difficulty multiplier; each stage may override it. */
	intensity: TicketIntensity.default("standard"),
	/** ISO date (`YYYY-MM-DD`) the work is due; `null` = undated. */
	dueDate: z.string().max(40).nullable().default(null),
	/** The ticket-level task list. */
	tasks: z.array(TicketTaskSchema).max(60).default([]),
	/** Names of files staged in the composer (upload wiring lands with the live backend). */
	attachmentNames: z.array(z.string().max(200)).max(20).default([]),
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

// #region Board write payloads
/**
 * Create or replace one ticket.
 *
 * `clientId` rides along so the answer can be RECONCILED rather than appended: the board splices an
 * optimistic card in before the request leaves, and without the echo the response would arrive as a
 * second card sitting beside the one the reader is already looking at. It is the client's optimistic
 * id when creating and the real ticket id when editing — the server tells the two apart, the client
 * never has to.
 *
 * There is deliberately no price field, for the same reason {@link CreateTicketSchema} has none: a
 * ticket's cost is the sum of its stages at the multipliers the client chose, so a typed total would
 * be a second arithmetic path that can round differently from the one the card renders.
 *
 * `attachmentIds` are `files.items` ids, uploaded through the files handshake BEFORE this call. Bytes
 * never transit an application route, which is the whole reason `/api/files/upload-init` exists.
 */
export const CommitTicketSchema = z.object({
	projectId: z.string().min(1).max(120),
	/** The client-minted id (`draft-…`/`ticket-…`) or a real ticket id when editing. */
	clientId: z.string().min(1).max(120),
	title: z.string().min(1).max(200),
	description: z.string().max(8000),
	status: TicketStatus,
	stageId: z.string().max(80).nullable(),
	priority: TicketPriority,
	intensity: TicketIntensity,
	dueDate: z.string().max(40).nullable(),
	ownerId: z.string().max(80).nullable(),
	tasks: z.array(TicketTaskSchema).max(100),
	stages: z.array(TicketStageRefSchema).max(50),
	attachmentIds: z.array(z.string().min(1).max(120)).max(50).default([]),
});
export type CommitTicket = z.infer<typeof CommitTicketSchema>;

/**
 * A board drag, resolved to what the server must do.
 *
 * The client sends the RESOLVED destination — the column's `ticket_status` and the stage it lands in —
 * rather than a column id, because the column vocabulary is a display concern
 * ({@link cardColumnId} maps one card into three different lanes depending on the view) and the server
 * must never have to reverse-engineer a lifecycle transition from a rendering decision.
 *
 * `sortOrder` is honoured only in the backlog lane: `trg_ticket_ordering_guard` raises if `sort_order`
 * changes while `status <> 'backlog'`, so a manual position sent for any other lane is dropped rather
 * than passed through to a statement that would fail.
 */
export const MoveTicketSchema = z.object({
	projectId: z.string().min(1).max(120),
	ticketId: z.string().min(1).max(120),
	/** The resolved target status (the column's `ticket_status`). */
	status: TicketStatus,
	/** The stage the ticket lands in; `null` for the New/Completed lanes. */
	stageId: z.string().max(80).nullable(),
	/** New manual position within the destination lane. Honoured only in the backlog lane. */
	sortOrder: z.number().int().min(0).nullable(),
});
export type MoveTicket = z.infer<typeof MoveTicketSchema>;
// #endregion
