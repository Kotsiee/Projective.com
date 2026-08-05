import {
	type BoardCard,
	type BoardListParams,
	type BoardPage,
	type BoardStageRef,
	type BoardView,
	buildBoardColumns,
	type FileItem,
	formatTicketMoney,
	type ProjectDetail,
	type ProjectParty,
	type StageAssignmentMode,
	type StageChannel,
	stageCostCents,
	type SubmissionTreeNode,
	type TicketHistoryEntry,
	type TicketHistoryKind,
	type TicketIntensity,
	type TicketPaymentEntry,
	type TicketPriority,
	type TicketStageRef,
	type TicketStatus,
	type TicketSubmissionFiles,
	type TicketTask,
	ticketTotalCents,
	workloadIntensity,
} from "@projective/types/projects";
import { messageAttachmentFacets } from "@projective/types/files";
import type { ContextType } from "@projective/types/auth";
import { findProjectDetail } from "./detail-fixtures.ts";

/**
 * projects board fixtures — the fat {@link ProjectBackendService}'s in-memory answer for the Kanban
 * board read (`/projects/[projectId]/board`) and the stage-level Tasks board
 * (`/projects/[projectId]/[channelId]/tasks`) while `PROJECTS_BACKEND_LIVE` is off (thin-frontend
 * pattern, root CLAUDE.md §10). Like the sibling reads it DERIVES a deterministic ticket corpus from the
 * resolved {@link ProjectDetail}'s stages (unsigned slug/stage hashes, a fixed reference clock, no RNG)
 * so the board always agrees with the sidebar/card that opened it. Columns map 1:1 to `ticket_status`
 * (New=backlog · Ready=todo · In Progress=in_progress[+claimed] · Review=in_review · Completed=completed).
 * The live path (RLS-scoped `projects.tickets` / `project_stages`, `move_ticket` / `reorder_stages` RPCs)
 * replaces this builder behind the same gate with zero shape churn (the projection is already
 * {@link BoardPageSchema}).
 */

// #region Reference clock + deterministic helpers
/** Fixed reference "now" (no `Date.now()`), matching the sibling fixtures. */
const NOW = Date.parse("2026-07-17T16:20:00Z");
const HOUR = 3_600_000;

/** A tiny stable hash → non-negative int (no RNG; SSR/resume stable — keep every index UNSIGNED). */
function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h;
}

const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** `Jul 14 · 2:30 PM` (UTC components — server-tz-independent, so SSR == the island refetch). */
function fmtDateTime(ms: number): string {
	const d = new Date(ms);
	let h = d.getUTCHours();
	const m = d.getUTCMinutes();
	const ampm = h < 12 ? "AM" : "PM";
	h = h % 12 || 12;
	return `${MO[d.getUTCMonth()]} ${d.getUTCDate()} · ${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}
// #endregion

// #region Vocabulary
const TITLES = [
	"Refine the onboarding flow",
	"Homepage hero exploration",
	"Design token audit",
	"Wire the checkout API",
	"Motion pass on the nav",
	"Accessibility sweep",
	"Empty-state illustrations",
	"Pricing page copy",
	"Dashboard chart polish",
	"Mobile menu redesign",
	"Component library docs",
	"Dark-mode contrast fixes",
	"Search relevance tuning",
	"Notification preferences UI",
	"Settings information architecture",
	"Marketing email template",
];
const PRIORITIES: readonly TicketPriority[] = ["low", "normal", "normal", "high", "urgent"];
const INTENSITIES: readonly TicketIntensity[] = [
	"standard",
	"standard",
	"low",
	"standard",
	"high",
];

/** Stage briefs — one line of real intent each, so the pipeline card's truncation has something to cut. */
const STAGE_BRIEFS = [
	"Establish the direction and agree the constraints before any production work starts.",
	"Produce the working files against the agreed direction, with sources attached.",
	"Review, revise and sign off, then hand over the production-ready assets.",
	"Instrument, measure and tune what shipped against the agreed targets.",
];

/** The CREATE-category baseline weights, in the order stages typically run. */
const CATEGORY_WEIGHTS = [1.2, 1.5, 0.7, 1.0, 0.8];

const ASSIGNMENT_MODES: readonly StageAssignmentMode[] = [
	"open_pull",
	"open_pull",
	"round_robin",
	"manual",
];

/** Steps a ticket's task list is built from. */
const TASK_TEXTS = [
	"Collect the reference material",
	"Draft the first pass",
	"Review against the acceptance criteria",
	"Apply the feedback",
	"Attach the working files",
	"Hand over for sign-off",
];

const VIEWER_ID = "viewer";

/** A rotating provider cast used when a fixture engagement has no assigned freelancers. */
const CAST: readonly ProjectParty[] = [
	{ name: "Ivy Chen", avatar: null, handle: "ivy" },
	{ name: "Marcus Lee", avatar: null, handle: "marcus" },
	{ name: "Aria Novak", avatar: null, handle: "aria" },
];
// #endregion

// #region Derivation
/** Whether a stage's column reorder is locked (started/claimed) — `fn_stage_reorder_lock` analogue. */
function stageLocked(stage: StageChannel): boolean {
	return stage.status !== "draft";
}

/** The provider cast eligible as assignees (non-owner / non-client members), or a stable fallback. */
function assigneePool(detail: ProjectDetail): ProjectParty[] {
	const providers = detail.members
		.filter((m) => m.role !== "owner" && m.role !== "client")
		.map((m) => m.party);
	return providers.length ? providers : [...CAST];
}

/**
 * A stage's derived commercial facts. Resolved ONCE per stage and read by both the board's stage
 * list and every ticket's stage refs, so a ticket can never quote a rate the pipeline disagrees
 * with — the drift the composer's derived total would otherwise expose.
 */
function stageEconomics(stage: StageChannel): {
	unitPriceCents: number | null;
	categoryWeight: number;
	description: string;
	assignmentMode: StageAssignmentMode;
	maxConcurrentIntensity: number | null;
} {
	const h = hash(`${stage.id}:econ`);
	return {
		// One stage in eight carries no rate yet — the "not priced" path has to be reachable.
		unitPriceCents: h % 8 === 3 ? null : (12 + (h % 14)) * 2500,
		categoryWeight: CATEGORY_WEIGHTS[stage.order % CATEGORY_WEIGHTS.length],
		description: STAGE_BRIEFS[stage.order % STAGE_BRIEFS.length],
		assignmentMode: ASSIGNMENT_MODES[h % ASSIGNMENT_MODES.length],
		maxConcurrentIntensity: h % 3 === 0 ? null : 2 + (h % 3),
	};
}

/**
 * A deterministic task list of `n` steps, seeded from the ticket.
 *
 * `completers` are the people who could have satisfied a step — the freelancer who claimed the work,
 * and the client when nobody has. A DONE step always carries at least one, because a step ticked off
 * by nobody is a state the product does not have: completion happens at the submission level, so
 * somebody submitted it.
 */
function taskList(
	seed: number,
	n: number,
	doneUpTo: number,
	prefix: string,
	completers: readonly ProjectParty[] = [],
): TicketTask[] {
	const out: TicketTask[] = [];
	for (let i = 0; i < n; i++) {
		const done = i < doneUpTo;
		// Occasionally two people satisfy the same step (parallel bands), so the stacked-avatar path
		// is reachable rather than theoretical.
		const many = completers.length > 1 && hash(`${prefix}:${i}:pair`) % 4 === 0;
		out.push({
			id: `${prefix}-task-${i}`,
			text: TASK_TEXTS[(seed + i) % TASK_TEXTS.length],
			done,
			completedBy: done && completers.length > 0
				? completers.slice(0, many ? 2 : 1).map((p) => ({ ...p }))
				: [],
		});
	}
	return out;
}

/**
 * Mark the leading `doneUpTo` steps of an existing list complete, attributing each to whoever
 * delivered it. Used for the stage-scoped lists, whose structure is built before the ticket's status
 * (and therefore its progress) is known.
 */
function completeUpTo(
	tasks: readonly TicketTask[],
	doneUpTo: number,
	completers: readonly ProjectParty[],
	prefix: string,
): TicketTask[] {
	return tasks.map((t, i) => {
		const done = i < doneUpTo;
		const many = completers.length > 1 && hash(`${prefix}:${i}:pair`) % 4 === 0;
		return {
			...t,
			done,
			completedBy: done && completers.length > 0
				? completers.slice(0, many ? 2 : 1).map((p) => ({ ...p }))
				: [],
		};
	});
}

/** The stages a ticket requires, from `startOrder` onward, capped — feeds the composer's pipeline. */
function stageRefs(
	stages: StageChannel[],
	startOrder: number,
	count: number,
	intensity: TicketIntensity,
	seed: number,
	ticketId: string,
): TicketStageRef[] {
	const slice = stages.filter((s) => s.order >= startOrder).slice(0, Math.max(1, count));
	const chosen = slice.length > 0 ? slice : stages.slice(0, 1);
	return chosen.map((s, i) => {
		const econ = stageEconomics(s);
		// A middle stage occasionally runs alongside the one before it, so the composer's execution
		// bands (and the detail modal's "at the same time" line) have a real case to render.
		const parallel = i > 0 && hash(`${ticketId}:${s.id}:par`) % 5 === 0;
		return {
			stageId: s.id,
			name: s.name,
			order: i,
			status: s.status,
			required: true,
			brief: econ.description,
			intensity,
			tasks: taskList(seed + i, 2 + ((seed >>> (i + 1)) % 2), 0, `${ticketId}-s${i}`),
			parallel,
			costCents: stageCostCents(econ.unitPriceCents, intensity),
			unitPriceCents: econ.unitPriceCents,
		};
	});
}

// #region Ticket contents (attachments · history · submissions)
const FILE_NAMES: readonly { name: string; ext: string; kind: string; category: string }[] = [
	{ name: "direction-board.png", ext: "png", kind: "image", category: "image" },
	{ name: "wireframes-v2.pdf", ext: "pdf", kind: "document", category: "pdf" },
	{ name: "handoff-notes.md", ext: "md", kind: "document", category: "document" },
	{ name: "component-audit.csv", ext: "csv", kind: "document", category: "spreadsheet" },
	{ name: "walkthrough.mp4", ext: "mp4", kind: "video", category: "video" },
];

const UNSPLASH =
	"https://images.unsplash.com/photo-1558655146-9f40138edfeb?auto=format&fit=crop&w=600&q=60";

/** A deterministic {@link FileItem} for a ticket attachment or a submitted deliverable. */
function makeFile(
	seed: number,
	i: number,
	id: string,
	sender: ProjectParty,
	channel: string,
): FileItem {
	const spec = FILE_NAMES[(seed + i) % FILE_NAMES.length];
	const bytes = (120 + ((seed >>> (i + 1)) % 900)) * 1024;
	const visual = spec.kind === "image" || spec.kind === "video";
	const at = NOW - (((seed + i) % 60) * HOUR);
	return {
		id,
		// The kinds/categories are the files domain's own vocabulary; the casts keep this fixture from
		// re-declaring those enums locally.
		kind: spec.kind as FileItem["kind"],
		category: spec.category as FileItem["category"],
		name: spec.name,
		ext: spec.ext,
		url: visual ? UNSPLASH : "#",
		thumbnailUrl: visual ? UNSPLASH : null,
		sizeBytes: bytes,
		sizeLabel: `${(bytes / (1024 * 1024)).toFixed(1)} MB`,
		width: visual ? 1600 : null,
		height: visual ? 1000 : null,
		durationLabel: spec.kind === "video" ? "1:24" : null,
		channelId: channel,
		channelName: "Ticket",
		channelKind: "stage",
		messageId: `${id}-msg`,
		messageText: "",
		messageAudioUrl: null,
		sender: {
			id: sender.handle ?? sender.name,
			name: sender.name,
			avatar: sender.avatar,
			handle: sender.handle,
		},
		createdAt: new Date(at).toISOString(),
		timeLabel: fmtDateTime(at).split(" · ")[1] ?? "",
		dayLabel: fmtDateTime(at).split(" · ")[0] ?? "",
		dateLabel: fmtDateTime(at),
		starred: false,
		// A ticket attachment / submitted deliverable sits in a semi-private review context, so it is
		// `link`-visible by construction — the same rule a channel attachment follows.
		...messageAttachmentFacets(sender.handle ?? sender.name),
	};
}

/** The ticket's audit log — one entry per transition it has actually been through. */
function makeHistory(
	id: string,
	seed: number,
	status: TicketStatus,
	assignee: ProjectParty | null,
	intensity: TicketIntensity,
	client: ProjectParty,
	/** The first submission unit's tree path, so the submission entry can be followed to it. */
	submissionPath: string[],
): TicketHistoryEntry[] {
	const steps: {
		kind: TicketHistoryKind;
		summary: string;
		detail: string | null;
		actor: ProjectParty | null;
		target?: string[];
	}[] = [
		{ kind: "created", summary: "created this ticket", detail: null, actor: client },
	];
	if (intensity !== "standard") {
		steps.push({
			kind: "intensity",
			summary: `set the intensity to ${intensity === "high" ? "High" : "Low"}`,
			detail: intensity === "high"
				? "Doubles the stage rate and the capacity it consumes."
				: "Halves the stage rate and the capacity it consumes.",
			actor: client,
		});
	}
	if (assignee) {
		steps.push({ kind: "assigned", summary: `claimed this ticket`, detail: null, actor: assignee });
	}
	if (status === "in_progress" || status === "in_review" || status === "completed") {
		steps.push({
			kind: "status",
			summary: "moved it to In Progress",
			detail: null,
			actor: assignee,
		});
	}
	if (status === "in_review" || status === "completed") {
		steps.push({
			kind: "submission",
			summary: "submitted work for review",
			detail: "2 files attached to the submission.",
			actor: assignee,
			target: submissionPath,
		});
	}
	if (status === "completed") {
		steps.push({
			kind: "status",
			summary: "approved the submission and closed the ticket",
			detail: "Escrow released to the freelancer.",
			actor: client,
		});
	}
	// Newest first — the log answers "what just happened" before "how did we get here".
	// The two most recent events on a ticket the viewer has not closed out read as unread, so the
	// footer's counter and the History rail's markers have a real case to draw.
	const unreadFrom = status === "completed" ? steps.length : Math.max(1, steps.length - 1);
	return steps.map((s, i) => {
		const at = NOW - ((steps.length - i) * 9 + (seed % 11)) * HOUR;
		return {
			id: `${id}-h${i}`,
			kind: s.kind,
			actor: s.actor,
			summary: s.summary,
			detail: s.detail,
			at: new Date(at).toISOString(),
			dateLabel: fmtDateTime(at),
			unread: i >= unreadFrom,
			targetPath: s.target ?? [],
		};
	}).reverse();
}

/**
 * The deliverable tree submitted against a ticket, plus the files under each unit.
 *
 * The hierarchy is deliberately **stage → submitter → unit**, matching the Submissions explorer's own
 * project-scope shape. That is not cosmetic: it makes a node's segment path identical to the review
 * route `/projects/[projectId]/submissions/[stageId]/[submitterId]/[submissionId]`, so the ticket
 * modal can hand a path straight to the explorer's addressing without a translation layer that would
 * be one more place for the two surfaces to disagree.
 */
function makeSubmissions(
	id: string,
	seed: number,
	status: TicketStatus,
	assignee: ProjectParty | null,
	stages: TicketStageRef[],
): { tree: SubmissionTreeNode[]; files: TicketSubmissionFiles[] } {
	if (!assignee || (status !== "in_review" && status !== "completed")) {
		return { tree: [], files: [] };
	}
	const submitter = assignee.handle ?? "submitter";
	// Work is submitted against the stages the ticket has already reached — the first two at most, so
	// a multi-stage ticket exercises the tree's stage level rather than always collapsing to one root.
	const submittedStages = stages.slice(0, Math.min(2, 1 + (seed % 2)));
	const files: TicketSubmissionFiles[] = [];
	const roots: SubmissionTreeNode[] = [];

	submittedStages.forEach((stage, s) => {
		const unitCount = 1 + ((seed >>> (s + 1)) % 2);
		const units: SubmissionTreeNode[] = [];
		for (let u = 0; u < unitCount; u++) {
			const segment = `${id}-s${s}-v${u + 1}`;
			const fileCount = 2 + ((seed >>> (u + 2)) % 2);
			const accepted = status === "completed" && s === submittedStages.length - 1 &&
				u === unitCount - 1;
			units.push({
				segment,
				kind: "unit",
				label: `${stage.name} · v${u + 1}`,
				sublabel: assignee.name,
				status: accepted ? "accepted" : "pending_review",
				fileCount,
				children: [],
			});
			files.push({
				path: [stage.stageId, submitter, segment],
				files: Array.from(
					{ length: fileCount },
					(_, i) =>
						makeFile(seed + (s * 5 + u) * 3, i, `${id}-s${s}u${u}-f${i}`, assignee, "submissions"),
				),
			});
		}
		const unitFiles = units.reduce((n, u) => n + u.fileCount, 0);
		roots.push({
			segment: stage.stageId,
			kind: "stage",
			label: stage.name,
			sublabel: "Stage",
			fileCount: unitFiles,
			children: [{
				segment: submitter,
				kind: "submitter",
				label: assignee.name,
				sublabel: "Freelancer",
				avatar: assignee.avatar,
				handle: assignee.handle,
				fileCount: unitFiles,
				children: units,
			}],
		});
	});

	return { tree: roots, files };
}

/** The path of the FIRST submission unit in a ticket's tree — where a submission event points. */
function firstUnitPath(tree: SubmissionTreeNode[]): string[] {
	const path: string[] = [];
	let nodes = tree;
	while (nodes.length > 0) {
		const node = nodes[0];
		path.push(node.segment);
		if (node.kind === "unit") return path;
		nodes = node.children;
	}
	return [];
}
// #endregion

// #region Money trail
/**
 * The ticket's escrow movements. Derived from the lifecycle it has actually been through, so the
 * Finances tab's audit history and the card's status can never tell different stories: nothing is
 * held before a claim, the platform's 5% is cut at release (root CLAUDE.md §8 Decision #2), and an
 * off-standard intensity leaves the adjustment that re-priced the hold.
 */
function makePayments(
	id: string,
	seed: number,
	status: TicketStatus,
	intensity: TicketIntensity,
	assignee: ProjectParty | null,
	client: ProjectParty,
	stages: TicketStageRef[],
	totalCents: number | null,
): TicketPaymentEntry[] {
	if (totalCents === null || !assignee) return [];
	const claimed = status === "claimed" || status === "in_progress" || status === "in_review" ||
		status === "completed";
	if (!claimed) return [];

	const rows: Omit<TicketPaymentEntry, "id" | "at" | "dateLabel">[] = [];
	for (const s of stages) {
		if (s.costCents === null) continue;
		rows.push({
			kind: "hold",
			state: status === "completed" ? "settled" : "held",
			label: `Escrow held · ${s.name}`,
			amountCents: s.costCents,
			stageId: s.stageId,
			party: client,
		});
	}
	if (intensity !== "standard" && stages.length > 0) {
		rows.push({
			kind: "adjustment",
			state: "settled",
			label: `Re-priced at ${intensity === "high" ? "High" : "Low"} intensity`,
			amountCents: 0,
			stageId: stages[0].stageId,
			party: client,
		});
	}
	if (status === "completed") {
		const fee = Math.round(totalCents * 0.05);
		rows.push({
			kind: "fee",
			state: "settled",
			label: "Platform fee (5%)",
			amountCents: -fee,
			stageId: null,
			party: null,
		});
		rows.push({
			kind: "release",
			state: "settled",
			label: "Released to freelancer",
			amountCents: totalCents - fee,
			stageId: null,
			party: assignee,
		});
	}

	return rows.map((r, i) => {
		const at = NOW - ((rows.length - i) * 11 + (seed % 7)) * HOUR;
		return { ...r, id: `${id}-p${i}`, at: new Date(at).toISOString(), dateLabel: fmtDateTime(at) };
	}).reverse();
}

/** Everyone who has actually touched the ticket, de-duplicated, in the order they first appear. */
function contributorsOf(history: TicketHistoryEntry[]): ProjectParty[] {
	const seen = new Set<string>();
	const out: ProjectParty[] = [];
	// The log is newest-first; walk it oldest-first so the cascade reads in involvement order.
	for (let i = history.length - 1; i >= 0; i--) {
		const actor = history[i].actor;
		if (!actor) continue;
		const key = actor.handle ?? actor.name;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(actor);
	}
	return out;
}
// #endregion

interface CardSeed {
	id: string;
	title: string;
	stageId: string | null;
	status: TicketStatus;
	assignee: ProjectParty | null;
	hasDesc: boolean;
	seed: number;
	sortOrder: number;
	stages: TicketStageRef[];
	intensity: TicketIntensity;
	client: ProjectParty;
	/** The client-side member accountable for it; `null` on a personally-owned engagement. */
	owner: ProjectParty | null;
	frozen?: boolean;
	revision?: boolean;
}

function makeCard(c: CardSeed): BoardCard {
	const claimed = c.status === "claimed" || c.status === "in_progress" ||
		c.status === "in_review" || c.status === "completed";
	const escrowHeld = claimed && c.status !== "completed";
	const checklistTotal = 3 + (c.seed % 4);
	/*
	 * A step is ticked off at the SUBMISSION level, so completion implies somebody submitted. An
	 * unclaimed ticket therefore has no completed steps — not as a display rule, but because there is
	 * nobody the completion could be attributed to, and a checklist showing progress with no face
	 * beside it is a state the product does not have.
	 */
	const checklistDone = !claimed
		? 0
		: c.status === "completed"
		? checklistTotal
		: c.status === "in_review"
		? checklistTotal - 1
		: (c.seed >>> 2) % (checklistTotal + 1);
	const activity = c.revision
		? "revision_requested" as const
		: c.status === "backlog" && c.stageId === null && c.seed % 4 === 0
		? "new_ticket" as const
		: null;
	const updatedAt = NOW - ((c.seed % 96) * HOUR);

	// Money and capacity are SUMMED from the stages, never invented for the card — the same rule the
	// composer's footer follows, so a card and the modal that opens it can never quote different totals.
	const budgetCents = ticketTotalCents(c.stages);
	const workload = Math.round(
		c.stages.reduce(
			(sum, s) =>
				sum + workloadIntensity(CATEGORY_WEIGHTS[s.order % CATEGORY_WEIGHTS.length], s.intensity),
			0,
		) * 100,
	) / 100;

	// Two tickets in five carry a date; one of those is already past, so the overdue tone is reachable.
	const dueOffsetDays = (c.seed % 5) - 1;
	const dated = c.seed % 5 < 2 && c.status !== "completed";
	const dueMs = NOW + dueOffsetDays * 24 * HOUR;
	/*
	 * Who could have ticked a step off. The freelancer who claimed the work leads, because completion
	 * is claimed at the submission level and that is who submits; the client follows, for the steps a
	 * reviewer signs off. Nobody at all until the ticket is claimed — which is exactly why an
	 * unclaimed ticket has no completed steps.
	 */
	const completers: ProjectParty[] = c.assignee ? [c.assignee, c.client] : [];
	const tasks = taskList(c.seed, checklistTotal, checklistDone, c.id, completers);
	// Stage steps track the ticket's own progress: everything on a delivered ticket, most of one in
	// review, about half of one being worked, none of one nobody has started.
	const stageProgress = c.status === "completed"
		? 1
		: c.status === "in_review"
		? 0.75
		: c.status === "in_progress"
		? 0.5
		: 0;
	const stages = c.stages.map((s, i) => ({
		...s,
		tasks: completeUpTo(
			s.tasks,
			Math.round(s.tasks.length * stageProgress),
			completers,
			`${c.id}-s${i}`,
		),
	}));
	const attachmentCount = (c.seed >>> 5) % 4;
	const submissions = makeSubmissions(c.id, c.seed, c.status, c.assignee, c.stages);
	const history = makeHistory(
		c.id,
		c.seed,
		c.status,
		c.assignee,
		c.intensity,
		c.client,
		firstUnitPath(submissions.tree),
	);

	return {
		id: c.id,
		title: c.title,
		description: c.hasDesc
			? `${c.title}. Deliver against the task list with the agreed acceptance criteria, and attach the working files for review.`
			: null,
		hasDescription: c.hasDesc,
		status: c.status,
		stageId: c.stageId,
		assignee: c.assignee,
		owner: c.owner,
		contributors: contributorsOf(history),
		claimed,
		escrowHeld,
		priority: PRIORITIES[c.seed % PRIORITIES.length],
		intensity: c.intensity,
		workload,
		dueDate: dated ? new Date(dueMs).toISOString() : null,
		dueLabel: dated ? fmtDateTime(dueMs).split(" · ")[0] : null,
		budgetCents,
		budgetLabel: budgetCents === null ? null : formatTicketMoney(budgetCents),
		activity,
		frozen: !!c.frozen,
		commentCount: (c.seed >>> 4) % 6,
		attachmentCount,
		checklistDone,
		checklistTotal,
		stages,
		tasks,
		attachments: Array.from(
			{ length: attachmentCount },
			(_, i) => makeFile(c.seed, i, `${c.id}-a${i}`, c.assignee ?? c.client, "ticket"),
		),
		history,
		submissions: submissions.tree,
		submissionFiles: submissions.files,
		payments: makePayments(
			c.id,
			c.seed,
			c.status,
			c.intensity,
			c.assignee,
			c.client,
			c.stages,
			budgetCents,
		),
		unreadCount: history.filter((h) => h.unread).length,
		updatedAt: new Date(updatedAt).toISOString(),
		dateLabel: fmtDateTime(updatedAt),
		sortOrder: c.sortOrder,
	};
}

/**
 * The client-side seats a ticket can be handed to inside a shared workspace. Empty on a personal
 * engagement, where there is nobody to hand it to and the selector therefore does not exist.
 */
function clientMemberPool(detail: ProjectDetail): ProjectParty[] {
	if (detail.scopeType === "personal") return [];
	const seats = detail.members
		.filter((m) => m.role === "client" || m.role === "owner")
		.map((m) => m.party);
	if (seats.length > 1) return seats;
	// A fixture engagement often records only one client seat; the workspace it belongs to has more,
	// so the rest of the buying side is derived from the same cast the rest of the board uses.
	const extra = CAST.filter((c) =>
		!seats.some((s) => (s.handle ?? s.name) === (c.handle ?? c.name))
	);
	return [...seats, ...extra.slice(0, 2)];
}

/** Build the whole engagement's ticket corpus (both boards select/filter from this). */
function buildCards(detail: ProjectDetail): BoardCard[] {
	const cards: BoardCard[] = [];
	const seed = hash(detail.slug);
	const stages = detail.channels.stages;
	const pool = assigneePool(detail);
	const pick = (h: number): ProjectParty => pool[h % pool.length];
	const client = detail.members.find((m) => m.role === "client" || m.role === "owner")?.party ??
		{ name: "The client", avatar: null, handle: null };
	// Inside a shared workspace a ticket carries an accountable client-side seat; roughly one in four
	// is left unassigned, so the "not yet assigned" state of the header selector is reachable.
	const clientSeats = clientMemberPool(detail);
	const ownerOf = (h: number): ProjectParty | null =>
		clientSeats.length === 0 || h % 4 === 0 ? null : clientSeats[h % clientSeats.length];
	let n = 0;
	const nextId = () => `${detail.slug}-t${++n}`;
	const intensityOf = (h: number): TicketIntensity => INTENSITIES[h % INTENSITIES.length];

	// 1) Project backlog pool (the New bookend) — some are title-only drafts (the purchasing gate demo).
	const backlogCount = 3 + (seed % 3);
	for (let i = 0; i < backlogCount; i++) {
		const h = hash(`${detail.slug}:new:${i}`);
		const id = nextId();
		const intensity = intensityOf(h);
		cards.push(makeCard({
			id,
			title: TITLES[h % TITLES.length],
			stageId: null,
			status: "backlog",
			assignee: null,
			hasDesc: i % 3 !== 0,
			seed: h,
			sortOrder: i,
			intensity,
			client,
			owner: ownerOf(h),
			stages: stageRefs(stages, 0, 1 + (h % 3), intensity, h, id),
		}));
	}
	// A frozen (reported_hidden) workload-report card, resting in New.
	{
		const h = hash(`${detail.slug}:frozen`);
		const id = nextId();
		cards.push(makeCard({
			id,
			title: TITLES[(h + 5) % TITLES.length],
			stageId: null,
			status: "reported_hidden",
			assignee: null,
			hasDesc: true,
			seed: h,
			sortOrder: backlogCount,
			intensity: "high",
			client,
			owner: ownerOf(h),
			stages: stageRefs(stages, 0, 1, "high", h, id),
			frozen: true,
		}));
	}

	// 2) Per-stage tickets.
	for (const stage of stages) {
		const span = 1 + (hash(`${detail.slug}:${stage.id}:span`) % 2);
		if (stage.status === "draft") {
			// Not started — a couple stage-local "New" (backlog) tickets awaiting a freelancer.
			const c = 1 + (hash(`${detail.slug}:${stage.id}:dc`) % 2);
			for (let i = 0; i < c; i++) {
				const h = hash(`${detail.slug}:${stage.id}:d${i}`);
				const id = nextId();
				const intensity = intensityOf(h);
				cards.push(makeCard({
					id,
					title: TITLES[h % TITLES.length],
					stageId: stage.id,
					status: "backlog",
					assignee: null,
					hasDesc: true,
					seed: h,
					sortOrder: i,
					intensity,
					client,
					owner: ownerOf(h),
					stages: stageRefs(stages, stage.order, span, intensity, h, id),
				}));
			}
			continue;
		}
		const statuses: TicketStatus[] = stage.status === "completed"
			? ["completed", "completed", "in_review"]
			: ["todo", "claimed", "in_progress", "in_review"];
		const count = 3 + (hash(`${detail.slug}:${stage.id}:c`) % 3);
		for (let i = 0; i < count; i++) {
			const h = hash(`${detail.slug}:${stage.id}:${i}`);
			const status = statuses[i % statuses.length];
			const assigned = status !== "todo";
			const id = nextId();
			const intensity = intensityOf(h);
			cards.push(makeCard({
				id,
				title: TITLES[h % TITLES.length],
				stageId: stage.id,
				status,
				assignee: assigned ? pick(h) : null,
				hasDesc: true,
				seed: h,
				sortOrder: i,
				intensity,
				client,
				owner: ownerOf(h),
				stages: stageRefs(stages, stage.order, span, intensity, h, id),
				revision: status === "in_review" && h % 4 === 0,
			}));
		}
	}

	// 3) A couple fully completed tickets (the Completed bookend).
	const last = stages[stages.length - 1];
	if (last) {
		for (let i = 0; i < 2; i++) {
			const h = hash(`${detail.slug}:done:${i}`);
			const id = nextId();
			const intensity = intensityOf(h);
			cards.push(makeCard({
				id,
				title: TITLES[(h + 2) % TITLES.length],
				stageId: last.id,
				status: "completed",
				assignee: pick(h),
				hasDesc: true,
				seed: h,
				sortOrder: i,
				intensity,
				client,
				owner: ownerOf(h),
				stages: stageRefs(stages, last.order, 1, intensity, h, id),
			}));
		}
	}
	return cards;
}
// #endregion

// #region Filtering + board title
function matches(card: BoardCard, params: BoardListParams): boolean {
	if (params.query && !card.title.toLowerCase().includes(params.query.toLowerCase())) return false;
	if (params.assignee && card.assignee?.handle !== params.assignee) return false;
	if (params.priority && card.priority !== params.priority) return false;
	return true;
}

function boardTitle(detail: ProjectDetail, kind: "project" | "stage"): string {
	if (kind === "stage") return "Tasks";
	if (detail.kind === "service" || detail.format === "session") return "Calendar";
	if (detail.format === "one_off") return "Timeline";
	return "Pipeline";
}
// #endregion

// #region Public builder
/** Resolve a board page for the params, or `null` when the project doesn't exist (→ 404). */
export function findBoardPage(params: BoardListParams): BoardPage | null {
	const detail = findProjectDetail(params.projectId);
	if (!detail) return null;

	const channelId = params.channelId ?? null;
	const kind: "project" | "stage" = channelId ? "stage" : "project";
	const view: BoardView = params.view ?? "stages";

	const all = buildCards(detail);
	let cards = all;
	if (kind === "stage") {
		const stage = detail.channels.stages.find(
			(s) => s.id === channelId || s.channel.id === channelId,
		);
		cards = stage ? all.filter((c) => c.stageId === stage.id) : [];
	}
	cards = cards.filter((c) => matches(c, params));

	const pool = assigneePool(detail);
	const stages: BoardStageRef[] = detail.channels.stages.map((s) => {
		const econ = stageEconomics(s);
		const h = hash(`${s.id}:roster`);
		// Rotate a deterministic slice of the provider cast onto each stage. Capped at the cast size —
		// a longer run would wrap and list the same person twice, and a roster that repeats a name is
		// worse than one that is simply short.
		const size = s.status === "draft" ? 0 : 1 + (h % pool.length);
		const members = Array.from({ length: size }, (_, i) => pool[(h + i) % pool.length]);
		return {
			id: s.id,
			name: s.name,
			order: s.order,
			status: s.status,
			locked: stageLocked(s),
			description: econ.description,
			unitPriceCents: econ.unitPriceCents,
			categoryWeight: econ.categoryWeight,
			members,
			ticketCount: all.filter((c) => c.stageId === s.id).length,
			assignmentMode: econ.assignmentMode,
			maxConcurrentIntensity: econ.maxConcurrentIntensity,
		};
	});
	const columns = buildBoardColumns(stages, view, kind);

	return {
		scope: channelId ? "channel" : "project",
		kind,
		projectId: params.projectId,
		channelId,
		format: detail.format,
		title: boardTitle(detail, kind),
		view,
		viewerIsClient: detail.viewerIsClient,
		columns,
		cards,
		stages,
		assignees: assigneePool(detail),
		workspaceKind: detail.scopeType as ContextType,
		workspaceLabel: detail.scopeLabel,
		clientMembers: clientMemberPool(detail),
		viewerId: VIEWER_ID,
		total: cards.length,
	};
}
// #endregion
