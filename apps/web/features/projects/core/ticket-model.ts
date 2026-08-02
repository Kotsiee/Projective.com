import {
	type BoardCard,
	type BoardStageRef,
	executionBands,
	formatTicketMoney,
	type ProjectParty,
	stageCostCents,
	TICKET_INTENSITY_LABEL,
	type TicketIntensity,
	type TicketStageRef,
	type TicketTask,
	ticketTotalCents,
	workloadIntensity,
} from "../types/projects-types.ts";

/**
 * ticket-model — the pure, DOM-free model behind the ONE ticket modal.
 *
 * There is a single working shape: a {@link BoardCard}. A ticket being composed is a card nobody has
 * saved yet, so create, view and edit are the same surface over the same data rather than two shapes
 * that have to be projected onto each other. The old `TicketDraft` existed only to bridge that gap,
 * and a bridge between two shapes is where they drift.
 *
 * Everything here is a pure function over that card: the reducers that mutate it, and the derived
 * money and capacity figures. No JSX and no signals, so the modal, the board and any future
 * server-side validation all derive identical results from the same functions.
 *
 * The money rule is the one worth stating plainly, because it is the reason there is no budget
 * field: **a ticket's price is never typed**. It is the sum of the stages the client selected, each
 * scaled by the difficulty multiplier they chose for it. A client composes a price by describing
 * work; they cannot assert one. The arithmetic itself belongs to the Zod SSOT
 * ({@link stageCostCents} / {@link ticketTotalCents}), so the backend can price the same card with
 * the same functions when `PROJECTS_BACKEND_LIVE` comes on.
 */

// #region Ids
let taskSeq = 0;
/** A collision-free local task id. Not persisted — the server assigns real ids on save. */
export function newTaskId(prefix = "t"): string {
	return `${prefix}-${Date.now().toString(36)}-${++taskSeq}`;
}

let cardSeq = 0;
/** A local id for a card that has not been saved yet. Replaced by the server's on commit. */
export function newDraftId(): string {
	return `draft-${Date.now().toString(36)}-${++cardSeq}`;
}
// #endregion

// #region Construction
/**
 * A blank ticket, optionally pre-seeded with the stage column the modal was opened from.
 *
 * Every field a saved ticket carries is present and empty rather than absent, so the create surface
 * and the view surface render from identical data and no tab has to ask whether it is looking at a
 * real ticket. The archives (history, submissions, payments) are empty because nothing has happened
 * yet — which is exactly what their empty states say.
 */
export function newTicketCard(
	defaultStageId: string | null,
	stages: readonly BoardStageRef[],
	owner: ProjectParty | null = null,
): BoardCard {
	const seed = defaultStageId ? stages.filter((s) => s.id === defaultStageId) : [];
	return reconcileCard({
		id: newDraftId(),
		title: "",
		description: null,
		hasDescription: false,
		status: "backlog",
		stageId: defaultStageId,
		assignee: null,
		owner,
		contributors: [],
		claimed: false,
		escrowHeld: false,
		priority: "normal",
		intensity: "standard",
		workload: 0,
		dueDate: null,
		dueLabel: null,
		budgetCents: null,
		budgetLabel: null,
		activity: null,
		frozen: false,
		commentCount: 0,
		attachmentCount: 0,
		checklistDone: 0,
		checklistTotal: 0,
		stages: seed.map((s, i) => blankStageRef(s, i)),
		tasks: [],
		attachments: [],
		history: [],
		submissions: [],
		submissionFiles: [],
		payments: [],
		unreadCount: 0,
		updatedAt: new Date().toISOString(),
		dateLabel: "Just now",
		sortOrder: 0,
	}, stages);
}

/**
 * A ticket's reference to a stage, with nothing configured yet.
 *
 * The stage's rate is CAPTURED here rather than looked up later: the Finances tab has to show the
 * arithmetic, and a stage re-rated tomorrow must not silently restate what this ticket was agreed at.
 */
export function blankStageRef(
	stage: BoardStageRef,
	order: number,
	intensity: TicketIntensity = "standard",
): TicketStageRef {
	return {
		stageId: stage.id,
		name: stage.name,
		order,
		status: stage.status,
		required: true,
		brief: "",
		// Seeded from the TICKET's difficulty, not from "standard". A stage added to a High ticket is
		// High work until the client says otherwise; defaulting it to standard would price the ticket
		// below what its own difficulty setting says it is.
		intensity,
		tasks: [],
		parallel: false,
		costCents: stageCostCents(stage.unitPriceCents, intensity),
		unitPriceCents: stage.unitPriceCents,
	};
}

/** Whether a card has never been saved — the condition the modal opens in `create` mode for. */
export function isDraftCard(card: BoardCard): boolean {
	return card.id.startsWith("draft-");
}
// #endregion

// #region Reconciliation (the ONE place a derived field is computed)
/**
 * Recompute every field a ticket DERIVES from its own primitives: its price, the capacity it
 * consumes, its checklist counts and its due label.
 *
 * Called after every patch, by the modal and the board alike, so there is exactly one arithmetic path
 * from "which stages at which intensity" to "what this costs". A second path is how a card and the
 * modal that opened it come to quote different totals.
 */
export function reconcileCard(card: BoardCard, stages: readonly BoardStageRef[]): BoardCard {
	const refs = normaliseStages(card.stages, stages);
	const resolved = refs.map((ref) => ({
		ref,
		stage: stages.find((s) => s.id === ref.stageId) ?? null,
	}));
	const totalCents = ticketTotalCents(refs);
	const workload = Math.round(
		resolved.reduce(
			(sum, r) => sum + workloadIntensity(r.stage?.categoryWeight ?? 1, r.ref.intensity),
			0,
		) * 100,
	) / 100;

	return {
		...card,
		stages: refs,
		hasDescription: hasContent(card.description),
		workload,
		budgetCents: totalCents,
		budgetLabel: totalCents === null ? null : formatTicketMoney(totalCents),
		dueLabel: formatDueDate(card.dueDate),
		checklistDone: card.tasks.filter((t) => t.done).length,
		checklistTotal: card.tasks.length,
	};
}

/**
 * Re-index a stage list and re-price it against the live board stages.
 *
 * Three invariants, each of which a naive edit breaks: `order` must match the array position after a
 * reorder; the FIRST stage can never be "simultaneous with the previous one" (there is nothing
 * before it, and a reorder can float a continuation to the front); and `costCents` must always be
 * `unitPriceCents × multiplier`, or the Finances tab shows arithmetic that does not add up.
 *
 * A stage the ticket references but the engagement no longer has keeps its captured name and rate —
 * it is dropped from nothing. A ticket priced against a deleted stage is a real condition, and
 * silently removing it would leave an unexplained figure in the total.
 */
export function normaliseStages(
	refs: readonly TicketStageRef[],
	stages: readonly BoardStageRef[],
): TicketStageRef[] {
	return refs.map((ref, i) => {
		const live = stages.find((s) => s.id === ref.stageId) ?? null;
		const unitPriceCents = live ? live.unitPriceCents : ref.unitPriceCents;
		return {
			...ref,
			name: live?.name ?? ref.name,
			status: live?.status ?? ref.status,
			order: i,
			parallel: i === 0 ? false : ref.parallel,
			unitPriceCents,
			costCents: stageCostCents(unitPriceCents, ref.intensity),
		};
	});
}

/** Whether a rich-text value carries actual content rather than an empty document's markup. */
export function hasContent(html: string | null): boolean {
	if (!html) return false;
	return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim().length > 0;
}
// #endregion

// #region Reducers (pure — each returns a new stage list)
/** Add a stage to the end of the pipeline, or remove it if already present. */
export const stageOps = {
	toggle(
		refs: readonly TicketStageRef[],
		stage: BoardStageRef,
		stages: readonly BoardStageRef[],
		intensity: TicketIntensity = "standard",
	): TicketStageRef[] {
		const present = refs.some((s) => s.stageId === stage.id);
		const next = present
			? refs.filter((s) => s.stageId !== stage.id)
			: [...refs, blankStageRef(stage, refs.length, intensity)];
		return normaliseStages(next, stages);
	},

	/** Patch one stage's configuration (its brief, its difficulty, its steps, its concurrency). */
	patch(
		refs: readonly TicketStageRef[],
		stageId: string,
		patch: Partial<TicketStageRef>,
		stages: readonly BoardStageRef[],
	): TicketStageRef[] {
		return normaliseStages(
			refs.map((s) => (s.stageId === stageId ? { ...s, ...patch } : s)),
			stages,
		);
	},

	/** Move a stage within the pipeline order. */
	move(
		refs: readonly TicketStageRef[],
		from: number,
		to: number,
		stages: readonly BoardStageRef[],
	): TicketStageRef[] {
		if (from === to || from < 0 || from >= refs.length) return [...refs];
		const next = refs.slice();
		const [moved] = next.splice(from, 1);
		next.splice(Math.max(0, Math.min(next.length, to)), 0, moved);
		return normaliseStages(next, stages);
	},
};

/**
 * Set the ticket's own difficulty, cascading it to every stage that was following it.
 *
 * The ticket-level intensity is the ticket's DEFAULT — "the client's difficulty multiplier, the
 * ticket's own default for every stage it touches" — and it is also the surface's headline price
 * lever. Those two facts only hold together if moving it moves the money, so it re-stamps the stages
 * beneath it. Without this it was a control that changed a word and nothing else: measured, raising
 * a ticket from Standard to High left the footer total at $1,225.
 *
 * It cascades to stages whose intensity matches the ticket's PREVIOUS value — the ones that were
 * tracking the default — and leaves alone any stage a client deliberately set to something else in
 * the inspector. That is precisely what "default" means, and it is why the cascade cannot be done in
 * {@link reconcileCard}, which has no memory of what the value was a moment ago.
 */
export function applyTicketIntensity(
	card: BoardCard,
	next: TicketIntensity,
	stages: readonly BoardStageRef[],
): BoardCard {
	const previous = card.intensity;
	if (next === previous) return card;
	return reconcileCard({
		...card,
		intensity: next,
		stages: card.stages.map((s) => (s.intensity === previous ? { ...s, intensity: next } : s)),
	}, stages);
}

/**
 * Task-list reducers, shared by the ticket-level list and every stage-level one.
 *
 * There is deliberately no `toggle`. A step is ticked off at the SUBMISSION level, where the work
 * that satisfies it is attached and reviewable — a checkbox on the ticket would let completion be
 * asserted with nothing behind it, and would have no honest answer for whose face to show beside it.
 */
export const taskOps = {
	add(list: readonly TicketTask[], text: string): TicketTask[] {
		const trimmed = text.trim();
		if (!trimmed) return [...list];
		return [...list, { id: newTaskId(), text: trimmed, done: false, completedBy: [] }];
	},
	remove(list: readonly TicketTask[], id: string): TicketTask[] {
		return list.filter((t) => t.id !== id);
	},
	patch(list: readonly TicketTask[], id: string, patch: Partial<TicketTask>): TicketTask[] {
		return list.map((t) => (t.id === id ? { ...t, ...patch } : t));
	},
	move(list: readonly TicketTask[], from: number, to: number): TicketTask[] {
		if (from === to || from < 0 || from >= list.length) return [...list];
		const next = list.slice();
		const [moved] = next.splice(from, 1);
		next.splice(Math.max(0, Math.min(next.length, to)), 0, moved);
		return next;
	},
};
// #endregion

// #region Derivation
/** A ticket's derived totals — the only figures the modal footer is allowed to show. */
export interface TicketTotals {
	stageCount: number;
	/** Total cost in minor units; `null` when nothing selected is priced. */
	totalCents: number | null;
	/** Pre-formatted total, or `null` — never "$0" for an unpriced pipeline. */
	totalLabel: string | null;
	/** Summed $W_i$ across the ticket's stages. */
	workload: number;
	/** How many execution bands the pipeline runs in (< stageCount means some run together). */
	bandCount: number;
	/** Stages selected but carrying no price — surfaced so the total is never silently partial. */
	unpricedCount: number;
}

export function ticketTotals(card: BoardCard): TicketTotals {
	const refs = [...card.stages].sort((a, b) => a.order - b.order);
	const totalCents = ticketTotalCents(refs);
	return {
		stageCount: refs.length,
		totalCents,
		totalLabel: totalCents === null ? null : formatTicketMoney(totalCents),
		workload: card.workload,
		bandCount: executionBands(refs).length,
		unpricedCount: refs.filter((r) => r.costCents === null).length,
	};
}
// #endregion

// #region Dirty tracking
/**
 * A stable string over everything a viewer can CHANGE on this surface.
 *
 * The footer's Save button appears the moment the working copy stops matching the ticket it was
 * opened from, so "has anything changed" has to be answerable cheaply on every keystroke and
 * answerable the SAME way every time. A fingerprint does that without a deep-equality walk and
 * without the two hazards a naive comparison has here: it ignores the derived fields (which the
 * reconciler rewrites on every patch, so comparing them would report a change that is only ever an
 * echo of one), and it is order-sensitive, because reordering a task list or a pipeline is itself an
 * edit.
 */
export function ticketFingerprint(card: BoardCard): string {
	const tasks = (list: readonly TicketTask[]) => list.map((t) => `${t.id}:${t.text}`).join("|");
	return JSON.stringify([
		card.title.trim(),
		card.description ?? "",
		card.priority,
		card.intensity,
		card.dueDate,
		card.owner?.handle ?? card.owner?.name ?? "",
		card.stageId ?? "",
		tasks(card.tasks),
		card.stages.map((s) =>
			[s.stageId, s.order, s.intensity, s.parallel ? 1 : 0, s.brief, tasks(s.tasks)].join("~")
		),
		card.attachments.map((a) => a.id),
	]);
}
// #endregion

// #region Gates
/** What the modal can and cannot do with the ticket as it stands. */
export interface TicketGate {
	/** A title is the only hard requirement — a title-only ticket is a valid draft placeholder. */
	canSave: boolean;
	/** The purchasing gate: a ticket needs a description before it can be purchased or claimed. */
	purchasable: boolean;
	/** The one line the footer states about the ticket's readiness. */
	message: string;
}

export function ticketGate(card: BoardCard, totals: TicketTotals): TicketGate {
	const canSave = card.title.trim().length > 0;
	const described = hasContent(card.description);
	const purchasable = described && totals.stageCount > 0;
	let message: string;
	if (!canSave) message = "Name the ticket to save it.";
	else if (!described) {
		message = "Saves as a draft. Add a description before it can be purchased or claimed.";
	} else if (totals.stageCount === 0) {
		message = "Saves as a draft. Add at least one stage before it can be purchased or claimed.";
	} else if (totals.unpricedCount > 0) {
		message = `${totals.unpricedCount} selected ${
			totals.unpricedCount === 1 ? "stage has" : "stages have"
		} no ticket rate yet, so the total is partial.`;
	} else message = "Ready to purchase once saved.";
	return { canSave, purchasable, message };
}
// #endregion

// #region Labels
/** "3 stages in 2 steps" — the pipeline shape in words, for the footer and the a11y summary. */
export function pipelineSummary(totals: TicketTotals): string {
	if (totals.stageCount === 0) return "No stages";
	const stages = `${totals.stageCount} stage${totals.stageCount === 1 ? "" : "s"}`;
	if (totals.bandCount === totals.stageCount) return stages;
	return `${stages} in ${totals.bandCount} step${totals.bandCount === 1 ? "" : "s"}`;
}

/** `Aug 4` / `Aug 4, 2027` — a due date shown at the resolution a human reads it at. */
export function formatDueDate(iso: string | null): string | null {
	if (!iso) return null;
	const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
	if (Number.isNaN(d.getTime())) return null;
	const now = new Date();
	const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
	return d.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: sameYear ? undefined : "numeric",
		timeZone: "UTC",
	});
}

/** Whether a due date has already passed (drives the overdue tone on the meta badge). */
export function isOverdue(iso: string | null): boolean {
	if (!iso) return false;
	const d = Date.parse(`${iso.slice(0, 10)}T23:59:59Z`);
	return Number.isFinite(d) && d < Date.now();
}

/** The `YYYY-MM-DD` a date control binds, from the ISO the card stores. */
export function toDateInput(iso: string | null): Date | null {
	if (!iso) return null;
	const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
	return Number.isNaN(d.getTime()) ? null : d;
}

/** The ISO date a card stores, from what a date control produced. */
export function fromDateInput(date: Date | null): string | null {
	if (!date || Number.isNaN(date.getTime())) return null;
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Intensity as options for a Select — the three multipliers, named, never numbered. A control
 * reading "High ×2" would state a conclusion the reader cannot check; the arithmetic lives on the
 * Finances tab, where it is shown working.
 */
export const INTENSITY_OPTIONS: { value: TicketIntensity; label: string }[] = [
	{ value: "low", label: TICKET_INTENSITY_LABEL.low },
	{ value: "standard", label: TICKET_INTENSITY_LABEL.standard },
	{ value: "high", label: TICKET_INTENSITY_LABEL.high },
];
// #endregion
