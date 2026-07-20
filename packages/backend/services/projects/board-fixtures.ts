import {
	type BoardCard,
	type BoardListParams,
	type BoardPage,
	type BoardStageRef,
	type BoardView,
	buildBoardColumns,
	type ProjectDetail,
	type ProjectParty,
	type StageChannel,
	type TicketPriority,
	type TicketStageRef,
	type TicketStatus,
} from "@projective/types/projects";
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
const TAGS = ["ui", "api", "copy", "motion", "a11y", "research", "bug", "polish"];
const PRIORITIES: readonly TicketPriority[] = ["low", "normal", "normal", "high", "urgent"];

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

/** The stages a ticket requires, from `startOrder` onward, capped — feeds the modal's stage list. */
function stageRefs(stages: StageChannel[], startOrder: number, count: number): TicketStageRef[] {
	const out: TicketStageRef[] = [];
	const slice = stages.filter((s) => s.order >= startOrder).slice(0, Math.max(1, count));
	slice.forEach((s, i) =>
		out.push({ stageId: s.id, name: s.name, order: i, status: s.status, required: true })
	);
	if (out.length === 0 && stages[0]) {
		out.push({
			stageId: stages[0].id,
			name: stages[0].name,
			order: 0,
			status: stages[0].status,
			required: true,
		});
	}
	return out;
}

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
	frozen?: boolean;
	revision?: boolean;
}

function makeCard(c: CardSeed): BoardCard {
	const claimed = c.status === "claimed" || c.status === "in_progress" ||
		c.status === "in_review" || c.status === "completed";
	const escrowHeld = claimed && c.status !== "completed";
	const checklistTotal = 3 + (c.seed % 4);
	const checklistDone = c.status === "completed"
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
	return {
		id: c.id,
		title: c.title,
		description: c.hasDesc
			? `${c.title}. Deliver against the checklist with the agreed acceptance criteria; attach the working files for review.`
			: null,
		hasDescription: c.hasDesc,
		status: c.status,
		stageId: c.stageId,
		assignee: c.assignee,
		claimed,
		escrowHeld,
		priority: PRIORITIES[c.seed % PRIORITIES.length],
		tags: [TAGS[c.seed % TAGS.length], TAGS[(c.seed >>> 3) % TAGS.length]].filter(
			(t, i, a) => a.indexOf(t) === i,
		),
		budgetLabel: `$${200 + (c.seed % 16) * 50}`,
		activity,
		frozen: !!c.frozen,
		commentCount: (c.seed >>> 4) % 6,
		attachmentCount: (c.seed >>> 5) % 4,
		checklistDone,
		checklistTotal,
		stages: c.stages,
		updatedAt: new Date(updatedAt).toISOString(),
		dateLabel: fmtDateTime(updatedAt),
		sortOrder: c.sortOrder,
	};
}

/** Build the whole engagement's ticket corpus (both boards select/filter from this). */
function buildCards(detail: ProjectDetail): BoardCard[] {
	const cards: BoardCard[] = [];
	const seed = hash(detail.slug);
	const stages = detail.channels.stages;
	const pool = assigneePool(detail);
	const pick = (h: number): ProjectParty => pool[h % pool.length];
	let n = 0;
	const nextId = () => `${detail.slug}-t${++n}`;

	// 1) Project backlog pool (the New bookend) — some are title-only drafts (the purchasing gate demo).
	const backlogCount = 3 + (seed % 3);
	for (let i = 0; i < backlogCount; i++) {
		const h = hash(`${detail.slug}:new:${i}`);
		cards.push(makeCard({
			id: nextId(),
			title: TITLES[h % TITLES.length],
			stageId: null,
			status: "backlog",
			assignee: null,
			hasDesc: i % 3 !== 0,
			seed: h,
			sortOrder: i,
			stages: stageRefs(stages, 0, 1 + (h % 2)),
		}));
	}
	// A frozen (reported_hidden) workload-report card, resting in New.
	{
		const h = hash(`${detail.slug}:frozen`);
		cards.push(makeCard({
			id: nextId(),
			title: TITLES[(h + 5) % TITLES.length],
			stageId: null,
			status: "reported_hidden",
			assignee: null,
			hasDesc: true,
			seed: h,
			sortOrder: backlogCount,
			stages: stageRefs(stages, 0, 1),
			frozen: true,
		}));
	}

	// 2) Per-stage tickets.
	for (const stage of stages) {
		const refs = stageRefs(stages, stage.order, 1 + (hash(`${detail.slug}:${stage.id}:span`) % 2));
		if (stage.status === "draft") {
			// Not started — a couple stage-local "New" (backlog) tickets awaiting a freelancer.
			const c = 1 + (hash(`${detail.slug}:${stage.id}:dc`) % 2);
			for (let i = 0; i < c; i++) {
				const h = hash(`${detail.slug}:${stage.id}:d${i}`);
				cards.push(makeCard({
					id: nextId(),
					title: TITLES[h % TITLES.length],
					stageId: stage.id,
					status: "backlog",
					assignee: null,
					hasDesc: true,
					seed: h,
					sortOrder: i,
					stages: refs,
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
			cards.push(makeCard({
				id: nextId(),
				title: TITLES[h % TITLES.length],
				stageId: stage.id,
				status,
				assignee: assigned ? pick(h) : null,
				hasDesc: true,
				seed: h,
				sortOrder: i,
				stages: refs,
				revision: status === "in_review" && h % 4 === 0,
			}));
		}
	}

	// 3) A couple fully completed tickets (the Completed bookend).
	const last = stages[stages.length - 1];
	if (last) {
		for (let i = 0; i < 2; i++) {
			const h = hash(`${detail.slug}:done:${i}`);
			cards.push(makeCard({
				id: nextId(),
				title: TITLES[(h + 2) % TITLES.length],
				stageId: last.id,
				status: "completed",
				assignee: pick(h),
				hasDesc: true,
				seed: h,
				sortOrder: i,
				stages: stageRefs(stages, last.order, 1),
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
	if (params.tag && !card.tags.includes(params.tag)) return false;
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

	const stages: BoardStageRef[] = detail.channels.stages.map((s) => ({
		id: s.id,
		name: s.name,
		order: s.order,
		status: s.status,
		locked: stageLocked(s),
	}));
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
		viewerId: VIEWER_ID,
		total: cards.length,
	};
}
// #endregion
