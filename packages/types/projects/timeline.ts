import { z } from "zod";
import {
	type BoardCard,
	BoardListParamsSchema,
	type BoardPage,
	BoardPageSchema,
	type BoardStageRef,
	executionBands,
	type TicketStatus,
} from "./board.ts";
import { ProjectFormat, type ProjectStatus } from "./summary.ts";

/**
 * projects.timeline — the Zod SSOT for the Timeline / Gantt read (`/projects/[projectId]/timeline`,
 * the whole engagement; `/projects/[projectId]/[channelId]/timeline`, one stage) and the ticket
 * modal's Timeline tab.
 *
 * It is a PROJECTION OVER THE BOARD, not a second read: {@link buildProjectTimeline} takes the
 * resolved {@link BoardPage} — the same stages, the same cards, the same viewer flags — and lays
 * them on a time axis. That is deliberate. The board is where a stage's dates and a ticket's due
 * date already live, so a timeline read with its own fetch would be a second place for "when is
 * this due" to be answered, and two answers to one question is how a bar and a card come to
 * disagree. The page therefore EMBEDS the board it was built from, which is also what lets the
 * timeline surface open the SAME ticket modal the board does without another round trip.
 *
 * NOTHING IS FABRICATED. A stage with no scheduled window is a lane with no bar; a ticket with no
 * due date is counted in its lane's caption and drawn nowhere; a claimed ticket with no due date is
 * a milestone at its claim, never a bar to an invented end. A plausible-looking span on an
 * unscheduled stage is worse than an empty lane, because the empty lane says "not planned yet" and
 * the span says "planned for then", and only one of those is true.
 *
 * Times are ISO strings on the wire (the domain convention, matching `dueDate`/`claimedAt`); the
 * engine converts to epoch ms at the boundary. Only enum/array/string/number/boolean primitives are
 * used so the schema stays stable across Zod majors.
 */

// #region Vocabulary
/** What a lane stands for. */
export const TimelineLaneKind = z.enum(["stage", "ticket", "backlog"]);
export type TimelineLaneKind = z.infer<typeof TimelineLaneKind>;

/** Whether an item is a span or an instant. */
export const TimelineItemKind = z.enum(["bar", "milestone"]);
export type TimelineItemKind = z.infer<typeof TimelineItemKind>;

/** What an item stands for — the popover's "Open" control routes on it. */
export const TimelineItemSubject = z.enum(["stage", "ticket"]);
export type TimelineItemSubject = z.infer<typeof TimelineItemSubject>;

/** Whether the timeline is the project-scope run or a channel-scope stage. */
export const TimelineScope = z.enum(["project", "channel"]);
export type TimelineScope = z.infer<typeof TimelineScope>;
// #endregion

// #region Lanes + items
/** One row of the timeline. */
export const TimelineLaneSchema = z.object({
	id: z.string().min(1).max(160),
	kind: TimelineLaneKind,
	label: z.string().min(1).max(200),
	/** A quieter second line — a status word, a step number. */
	sublabel: z.string().max(80).nullable().default(null),
	/** A short trailing figure ("4 tickets · 1 undated"). */
	meta: z.string().max(80).nullable().default(null),
	/** A CSS custom-property NAME (`"--primary"`) for the lane's own mark; `null` = the default. */
	accent: z.string().max(60).nullable().default(null),
	/** The party the row belongs to (a ticket lane's assignee), drawn as a small face. */
	avatar: z.object({
		name: z.string().min(1).max(120),
		url: z.string().max(400).nullable(),
	}).nullable().default(null),
	/** Nesting depth, `0` at the root. */
	depth: z.number().int().min(0).default(0),
	/** The stage this lane resolves to (a stage lane, or a ticket lane's stage); `null` = the backlog. */
	stageId: z.string().max(80).nullable().default(null),
	/** The ticket this lane IS (channel scope); `null` elsewhere. */
	ticketId: z.string().max(120).nullable().default(null),
	/** Whether a drag across this lane's empty space may create a ticket here. */
	creatable: z.boolean().default(false),
});
export type TimelineLane = z.infer<typeof TimelineLaneSchema>;

/** One thing on a lane. */
export const TimelineItemSchema = z.object({
	id: z.string().min(1).max(160),
	laneId: z.string().min(1).max(160),
	label: z.string().min(1).max(200),
	kind: TimelineItemKind,
	subject: TimelineItemSubject,
	/** ISO start. */
	start: z.string().max(40),
	/** ISO end. `=== start` for a milestone. */
	end: z.string().max(40),
	/** A CSS custom-property NAME accenting the item. */
	accent: z.string().max(60).nullable().default(null),
	/** Completion in `0..1`; `null` = no progress channel (a different fact from `0`). */
	progress: z.number().min(0).max(1).nullable().default(null),
	/** Ids of the items this one starts after (dependency links). */
	dependsOn: z.array(z.string().max(160)).max(20).default([]),
	/** The lifecycle word ("Active", "Overdue"). */
	status: z.string().max(40).nullable().default(null),
	/** A short secondary line for the popover and the accessible name. */
	meta: z.string().max(160).nullable().default(null),
	/** Whether the viewer may drag it to a new range (a ticket's due date). */
	movable: z.boolean().default(false),
	/** The stage the item belongs to. */
	stageId: z.string().max(80).nullable().default(null),
	/** The ticket the item IS; `null` for a stage item. */
	ticketId: z.string().max(120).nullable().default(null),
});
export type TimelineItem = z.infer<typeof TimelineItemSchema>;
// #endregion

// #region Request params + page envelope
/** The timeline query — the board's own scope pair. `channelId` set → one stage's timeline. */
export const TimelineListParamsSchema = BoardListParamsSchema.pick({
	projectId: true,
	channelId: true,
});
export type TimelineListParams = z.infer<typeof TimelineListParamsSchema>;

/** The resolved timeline — its lanes and items, the instant it was built at, and the board beneath. */
export const TimelinePageSchema = z.object({
	scope: TimelineScope,
	projectId: z.string().min(1).max(120),
	channelId: z.string().max(120).nullable(),
	format: ProjectFormat,
	/** Pre-resolved heading ("Timeline" / "Stage timeline") so SSR + the client render identically. */
	title: z.string().min(1).max(60),
	/** Whether the acting user is the client — gates drag-to-create and moving a due date. */
	viewerIsClient: z.boolean(),
	/**
	 * The instant the page was built at, ISO. The "today" rule and every "Overdue" word derive from
	 * it, so a fixture-driven build and its fixed clock agree, and a live build carries the server's
	 * clock rather than trusting the browser's.
	 */
	now: z.string().max(40),
	/**
	 * The display timezone the SERVER resolved, or `null` to let the viewer's own zone govern. The
	 * fixtures carry none — they are read from every zone — so the island resolves the local one.
	 */
	timezone: z.string().max(64).nullable().default(null),
	lanes: z.array(TimelineLaneSchema),
	items: z.array(TimelineItemSchema),
	/** The overall extent of every drawn item, or `null` when nothing is dated. */
	range: z.object({ start: z.string().max(40), end: z.string().max(40) }).nullable(),
	/** How many tickets carry no date at all and are therefore drawn nowhere. */
	undatedCount: z.number().int().min(0),
	/** The board this timeline was projected from — the ticket modal and the create flow read it. */
	board: BoardPageSchema,
});
export type TimelinePage = z.infer<typeof TimelinePageSchema>;
// #endregion

// #region Words + accents
/** The plain word for a stage's lifecycle status. */
export const STAGE_STATUS_WORD: Record<ProjectStatus, string> = {
	draft: "Draft",
	active: "Active",
	on_hold: "On hold",
	completed: "Completed",
	cancelled: "Cancelled",
};

/** The plain word for a ticket's status, in the board's display vocabulary (Decision #35). */
export const TICKET_STATUS_WORD: Record<TicketStatus, string> = {
	backlog: "New",
	todo: "Ready",
	claimed: "Claimed",
	in_progress: "In progress",
	in_review: "In review",
	completed: "Completed",
	cancelled: "Cancelled",
	reported_hidden: "Frozen",
};

/**
 * The accent token for a stage by status. Tokens, never colours: the engine resolves them through
 * its theme bridge, so the a11y overlays and a theme switch reach the canvas.
 */
export function stageAccentFor(status: ProjectStatus): string {
	switch (status) {
		case "active":
			return "--primary";
		case "completed":
			return "--success";
		case "on_hold":
			return "--warning";
		case "cancelled":
			return "--danger";
		default:
			return "--tertiary";
	}
}

/** The accent token for a ticket by status. */
export function ticketAccentFor(status: TicketStatus): string {
	switch (status) {
		case "in_progress":
		case "claimed":
			return "--primary";
		case "in_review":
			return "--secondary";
		case "completed":
			return "--success";
		case "cancelled":
		case "reported_hidden":
			return "--danger";
		default:
			return "--tertiary";
	}
}
// #endregion

// #region Builders
/** What the builders need beyond the board. */
export interface TimelineBuildOptions {
	/** The reference instant, epoch ms. */
	nowMs: number;
	/** The display timezone the server resolved, or `null` for the viewer's own. */
	timezone?: string | null;
}

/** Parse an ISO instant, or `null` for anything that is not one. */
function msOf(iso: string | null | undefined): number | null {
	if (!iso) return null;
	const ms = Date.parse(iso);
	return Number.isFinite(ms) ? ms : null;
}

function iso(ms: number): string {
	return new Date(ms).toISOString();
}

const STAGE_LANE = (id: string) => `stage:${id}`;
const TICKET_LANE = (id: string) => `ticket:${id}`;
const STAGE_ITEM = (id: string) => `stage-item:${id}`;
const TICKET_ITEM = (id: string) => `ticket-item:${id}`;
const BACKLOG_LANE = "backlog";

function plural(n: number, one: string, many = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`;
}

/** A stage's window as a drawable item, or `null` when it carries no date at all. */
function stageItem(
	stage: BoardStageRef,
	laneId: string,
	progress: number | null,
	nowMs: number,
	knownItemIds: ReadonlySet<string>,
): TimelineItem | null {
	const start = msOf(stage.startAt);
	const end = msOf(stage.endAt);
	if (start === null && end === null) return null;
	const overdue = end !== null && end < nowMs && stage.status !== "completed" &&
		stage.status !== "cancelled";
	const status = overdue ? "Overdue" : STAGE_STATUS_WORD[stage.status];
	const accent = overdue ? "--warning" : stageAccentFor(stage.status);
	const dependsOn = stage.dependsOnStageId && knownItemIds.has(STAGE_ITEM(stage.dependsOnStageId))
		? [STAGE_ITEM(stage.dependsOnStageId)]
		: [];
	// Both dates → a span. One date → an instant at the date that exists, named for which it is: a
	// stage with only a start has been scheduled to begin, not to finish, and a bar to nowhere would
	// say otherwise.
	if (start !== null && end !== null && end >= start) {
		return {
			id: STAGE_ITEM(stage.id),
			laneId,
			label: stage.name,
			kind: "bar",
			subject: "stage",
			start: iso(start),
			end: iso(end),
			accent,
			progress,
			dependsOn,
			status,
			meta: plural(stage.ticketCount, "ticket"),
			movable: false,
			stageId: stage.id,
			ticketId: null,
		};
	}
	const at = end ?? start ?? nowMs;
	return {
		id: STAGE_ITEM(stage.id),
		laneId,
		label: end !== null ? `${stage.name} due` : `${stage.name} starts`,
		kind: "milestone",
		subject: "stage",
		start: iso(at),
		end: iso(at),
		accent,
		progress: null,
		dependsOn,
		status,
		meta: plural(stage.ticketCount, "ticket"),
		movable: false,
		stageId: stage.id,
		ticketId: null,
	};
}

/**
 * A ticket as a drawable item on `laneId`, or `null` when it carries no date at all.
 *
 * Claimed AND due → a bar from the claim to the deadline. Due only → a milestone at the deadline.
 * Claimed only → a milestone at the claim. A due date BEFORE the claim (a ticket claimed late)
 * collapses to the deadline milestone rather than a negative span.
 */
function ticketItem(
	card: BoardCard,
	laneId: string,
	nowMs: number,
	movable: boolean,
): TimelineItem | null {
	const claimed = msOf(card.claimedAt);
	const due = msOf(card.dueDate);
	if (claimed === null && due === null) return null;
	const done = card.status === "completed";
	const overdue = due !== null && due < nowMs && !done && card.status !== "cancelled";
	const status = overdue ? "Overdue" : TICKET_STATUS_WORD[card.status];
	const accent = overdue ? "--warning" : ticketAccentFor(card.status);
	const progress = card.checklistTotal > 0 ? card.checklistDone / card.checklistTotal : null;
	const metaParts: string[] = [];
	if (card.assignee) metaParts.push(card.assignee.name);
	if (card.checklistTotal > 0) metaParts.push(`${card.checklistDone}/${card.checklistTotal} tasks`);
	if (card.budgetLabel) metaParts.push(card.budgetLabel);
	const meta = metaParts.length > 0 ? metaParts.join(" · ") : null;
	const base = {
		id: TICKET_ITEM(card.id),
		laneId,
		label: card.title,
		subject: "ticket" as const,
		accent,
		dependsOn: [] as string[],
		status,
		meta,
		stageId: card.stageId,
		ticketId: card.id,
	};
	if (claimed !== null && due !== null && due >= claimed) {
		return {
			...base,
			kind: "bar",
			start: iso(claimed),
			end: iso(due),
			progress,
			movable,
		};
	}
	const at = due ?? claimed ?? nowMs;
	return {
		...base,
		kind: "milestone",
		start: iso(at),
		end: iso(at),
		progress: null,
		// A milestone at a CLAIM is not a deadline and cannot be moved to one.
		movable: movable && due !== null,
	};
}

/** The overall extent of a set of items. */
function rangeOf(items: readonly TimelineItem[]): TimelinePage["range"] {
	let start = Infinity;
	let end = -Infinity;
	for (const it of items) {
		const s = msOf(it.start);
		const e = msOf(it.end);
		if (s !== null) start = Math.min(start, s);
		if (e !== null) end = Math.max(end, e);
	}
	return Number.isFinite(start) && Number.isFinite(end)
		? { start: iso(start), end: iso(end) }
		: null;
}

/** Completed tickets over all tickets in a stage, or `null` when it has none. */
function stageProgress(cards: readonly BoardCard[], stageId: string): number | null {
	const inStage = cards.filter((c) => c.stageId === stageId && c.status !== "cancelled");
	if (inStage.length === 0) return null;
	const done = inStage.filter((c) => c.status === "completed").length;
	return done / inStage.length;
}

/**
 * Project the board onto a time axis.
 *
 * PROJECT scope: one lane per stage (in pipeline order) carrying the stage's own window as a bar
 * and every dated ticket in that stage as an item, then a trailing backlog lane for dated tickets
 * that sit in no stage yet. Stage dependencies become links.
 *
 * CHANNEL scope (a stage board): the stage's own lane first, then one lane per TICKET so the stage's
 * work reads as a schedule rather than a pile — each ticket lane carries the assignee's face and the
 * ticket's item.
 *
 * Pure and total: never throws, never reads a clock (the instant is an argument), never invents a
 * date.
 */
export function buildProjectTimeline(board: BoardPage, opts: TimelineBuildOptions): TimelinePage {
	const nowMs = opts.nowMs;
	const lanes: TimelineLane[] = [];
	const items: TimelineItem[] = [];
	const stages = [...board.stages].sort((a, b) => a.order - b.order);
	const movable = board.viewerIsClient;
	let undated = 0;

	if (board.kind === "project") {
		// Stage items first, so a dependency can resolve against a predecessor that exists.
		const stageItemIds = new Set(
			stages.filter((s) => s.startAt || s.endAt).map((s) => STAGE_ITEM(s.id)),
		);
		for (const stage of stages) {
			const laneId = STAGE_LANE(stage.id);
			const inStage = board.cards.filter((c) => c.stageId === stage.id);
			const laneUndated = inStage.filter((c) => !c.dueDate && !c.claimedAt).length;
			undated += laneUndated;
			const metaParts = [plural(inStage.length, "ticket")];
			if (laneUndated > 0) metaParts.push(`${laneUndated} undated`);
			lanes.push({
				id: laneId,
				kind: "stage",
				label: stage.name,
				sublabel: STAGE_STATUS_WORD[stage.status],
				meta: metaParts.join(" · "),
				accent: stageAccentFor(stage.status),
				avatar: null,
				depth: 0,
				stageId: stage.id,
				ticketId: null,
				creatable: movable,
			});
			const si = stageItem(
				stage,
				laneId,
				stageProgress(board.cards, stage.id),
				nowMs,
				stageItemIds,
			);
			if (si) items.push(si);
			for (const card of inStage) {
				const ti = ticketItem(card, laneId, nowMs, movable);
				if (ti) items.push(ti);
			}
		}
		const backlog = board.cards.filter((c) => c.stageId === null);
		const backlogUndated = backlog.filter((c) => !c.dueDate && !c.claimedAt).length;
		undated += backlogUndated;
		const backlogMeta = [plural(backlog.length, "ticket")];
		if (backlogUndated > 0) backlogMeta.push(`${backlogUndated} undated`);
		lanes.push({
			id: BACKLOG_LANE,
			kind: "backlog",
			label: "New",
			sublabel: "Not in a stage yet",
			meta: backlogMeta.join(" · "),
			accent: null,
			avatar: null,
			depth: 0,
			stageId: null,
			ticketId: null,
			creatable: movable,
		});
		for (const card of backlog) {
			const ti = ticketItem(card, BACKLOG_LANE, nowMs, movable);
			if (ti) items.push(ti);
		}
	} else {
		// The stage a channel board is scoped to is the one its cards sit in. With no cards there is
		// nothing to identify it by, and a lane for "some stage" would be a guess.
		const stageIds = new Set(board.cards.map((c) => c.stageId).filter((id): id is string => !!id));
		const stage = stageIds.size === 1 ? stages.find((s) => stageIds.has(s.id)) ?? null : null;
		if (stage) {
			const laneId = STAGE_LANE(stage.id);
			lanes.push({
				id: laneId,
				kind: "stage",
				label: stage.name,
				sublabel: STAGE_STATUS_WORD[stage.status],
				meta: plural(board.cards.length, "ticket"),
				accent: stageAccentFor(stage.status),
				avatar: null,
				depth: 0,
				stageId: stage.id,
				ticketId: null,
				creatable: movable,
			});
			const si = stageItem(stage, laneId, stageProgress(board.cards, stage.id), nowMs, new Set());
			if (si) items.push(si);
		}
		const cards = [...board.cards].sort((a, b) => a.sortOrder - b.sortOrder);
		for (const card of cards) {
			const laneId = TICKET_LANE(card.id);
			const dated = !!card.dueDate || !!card.claimedAt;
			if (!dated) undated++;
			lanes.push({
				id: laneId,
				kind: "ticket",
				label: card.title,
				sublabel: TICKET_STATUS_WORD[card.status],
				meta: dated ? card.dueLabel : "Undated",
				accent: ticketAccentFor(card.status),
				avatar: card.assignee ? { name: card.assignee.name, url: card.assignee.avatar } : null,
				depth: stage ? 1 : 0,
				stageId: card.stageId,
				ticketId: card.id,
				creatable: false,
			});
			const ti = ticketItem(card, laneId, nowMs, movable);
			if (ti) items.push(ti);
		}
	}

	return {
		scope: board.scope,
		projectId: board.projectId,
		channelId: board.channelId,
		format: board.format,
		title: board.kind === "project" ? "Timeline" : "Stage timeline",
		viewerIsClient: board.viewerIsClient,
		now: iso(nowMs),
		timezone: opts.timezone ?? null,
		lanes,
		items,
		range: rangeOf(items),
		undatedCount: undated,
		board,
	};
}

/** The lanes + items of one ticket's stage run — what the ticket modal's Timeline tab draws. */
export interface TicketTimeline {
	lanes: TimelineLane[];
	items: TimelineItem[];
	range: TimelinePage["range"];
}

/**
 * One ticket's run through its stages, as a schedule.
 *
 * A lane per stage the ticket requires, in the ticket's own order, with the step number derived
 * from {@link executionBands} so two stages that start together read as one step. Each lane carries
 * the LIVE stage's scheduled window (when it has one) — the ticket's per-stage timing is not a
 * recorded fact and is not invented here — and the bands become dependency links, so the run reads
 * left to right. A trailing "This ticket" lane carries the ticket's own claim→due item.
 */
export function buildTicketTimeline(
	card: BoardCard,
	stages: readonly BoardStageRef[],
	opts: TimelineBuildOptions,
): TicketTimeline {
	const nowMs = opts.nowMs;
	const byId = new Map(stages.map((s) => [s.id, s]));
	const lanes: TimelineLane[] = [];
	const items: TimelineItem[] = [];
	const ordered = [...card.stages].sort((a, b) => a.order - b.order);
	const bands = executionBands(ordered);
	// Links run band to band: every stage in a band starts after every stage in the band before it.
	let previousBandItems: string[] = [];
	bands.forEach((band, bandIndex) => {
		const bandItems: string[] = [];
		for (const ref of band) {
			const laneId = STAGE_LANE(ref.stageId);
			const live = byId.get(ref.stageId) ?? null;
			const status = live?.status ?? ref.status;
			lanes.push({
				id: laneId,
				kind: "stage",
				label: ref.name,
				sublabel: `Step ${bandIndex + 1}${band.length > 1 ? " · together" : ""}`,
				meta: STAGE_STATUS_WORD[status],
				accent: stageAccentFor(status),
				avatar: null,
				depth: 0,
				stageId: ref.stageId,
				ticketId: null,
				creatable: false,
			});
			if (!live) continue;
			const item = stageItem(live, laneId, null, nowMs, new Set());
			if (!item) continue;
			items.push({ ...item, dependsOn: previousBandItems });
			bandItems.push(item.id);
		}
		if (bandItems.length > 0) previousBandItems = bandItems;
	});

	const ownLane = TICKET_LANE(card.id);
	lanes.push({
		id: ownLane,
		kind: "ticket",
		label: "This ticket",
		sublabel: TICKET_STATUS_WORD[card.status],
		meta: card.dueLabel ? `Due ${card.dueLabel}` : "No due date",
		accent: ticketAccentFor(card.status),
		avatar: card.assignee ? { name: card.assignee.name, url: card.assignee.avatar } : null,
		depth: 0,
		stageId: card.stageId,
		ticketId: card.id,
		creatable: false,
	});
	const own = ticketItem(card, ownLane, nowMs, false);
	if (own) items.push(own);

	return { lanes, items, range: rangeOf(items) };
}
// #endregion
