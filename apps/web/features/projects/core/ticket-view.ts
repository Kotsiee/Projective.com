import { createModalStack } from "@projective/ui/overlay";
import type { IconName } from "@projective/ui/icons";
import type {
	BoardCard,
	BoardStageRef,
	FileItem,
	SubmissionReview,
	SubmissionTreeNode,
	TicketStageRef,
} from "../types/projects-types.ts";
import {
	executionBands,
	formatTicketMoney,
	stageCostCents,
	ticketSpentCents,
	workloadIntensity,
} from "../types/projects-types.ts";

/**
 * ticket-view — the pure model behind the View Ticket modal: its tab vocabulary, its footer metrics,
 * the ticket-scoped submission projections, and the ONE modal stack every ticket surface routes
 * through.
 *
 * No JSX and no DOM, so SSR, the board island and the modal itself derive identical answers. The
 * money side delegates entirely to the Zod SSOT ({@link ticketCostLines} / {@link stageCostCents}) —
 * a ticket's price is the sum of its stages at their chosen difficulty, and this file re-states none
 * of that arithmetic.
 */

// #region The modal stack
/**
 * Which surface a frame renders. They form a chain rather than a pile: opening a review from inside
 * a ticket REPLACES the ticket rather than covering it, so one backdrop blur is ever composited, and
 * dismissing the review restores the ticket at the tab and scroll offset it was left at.
 */
export type TicketFrameKind = "ticket" | "review" | "file";

/** Open-time input for a frame. Live UI state lives in the stack's cache, not here. */
export interface TicketFrameInput {
	/** For a `review`/`file` frame: the submission tree path it was opened at. */
	path?: string[];
	/** For a `file` frame: which file in the unit to open on. */
	fileId?: string;
	/** The ticket the chain started from — a review frame still needs it to go back. */
	ticketId?: string;
	/**
	 * `create` when the frame is composing a ticket that does not exist yet.
	 *
	 * Carried on the frame rather than held beside the stack so the posture survives a review round
	 * trip with everything else — a chain restored into the wrong mode would offer Save on a ticket
	 * nobody has created.
	 */
	mode?: TicketMode;
}

/**
 * The board's single modal chain. Module-level because the board body, the ticket modal and the
 * review modal are the same hydration root but different component subtrees, and a chain that only
 * one of them can reach is not a chain.
 */
export const ticketStack = createModalStack<TicketFrameKind, TicketFrameInput>();
// #endregion

// #region Tabs
/** The View Ticket modal's left-hand tabs, in order. History is pinned last and icon-only. */
export type TicketTab =
	| "details"
	| "submissions"
	| "stages"
	| "finances"
	| "attachments"
	| "history";

/** One tab as the strip renders it. */
export interface TicketTabSpec {
	key: TicketTab;
	label: string;
	icon: IconName;
	/** A count worth surfacing on the trigger, or `null` when the tab is not a collection. */
	count: number | null;
	/**
	 * Whether the trigger drops its label and shows only its glyph. History is the one — it is an
	 * archive rather than a working view, so it sits apart at the far end (§B.6 icon-first).
	 */
	iconOnly: boolean;
}

/** Which job the modal is doing. One surface, two postures — never two components. */
export type TicketMode = "create" | "view";

/**
 * The tab strip for a ticket.
 *
 * On a SAVED ticket every tab is always present: one with no attachments still HAS an attachments
 * tab, because its emptiness is a fact about the ticket the viewer came to learn, and a strip whose
 * tabs appear and vanish per ticket cannot be navigated by memory.
 *
 * A ticket being CREATED is the one exception, and not for tidiness. Submissions and History are
 * archives of things that have happened, and nothing has happened to a ticket that does not exist
 * yet — an empty archive on a new ticket would not be reporting emptiness, it would be inviting the
 * reader to wonder what they had missed.
 */
export function ticketTabs(card: BoardCard, mode: TicketMode = "view"): TicketTabSpec[] {
	const tabs: TicketTabSpec[] = [
		{ key: "details", label: "Details", icon: "document", count: null, iconOnly: false },
	];
	if (mode === "view") {
		tabs.push({
			key: "submissions",
			label: "Submissions",
			icon: "submission",
			count: countUnits(card.submissions),
			iconOnly: false,
		});
	}
	tabs.push(
		{ key: "stages", label: "Stages", icon: "stages", count: card.stages.length, iconOnly: false },
		{ key: "finances", label: "Finances", icon: "wallet", count: null, iconOnly: false },
		{
			key: "attachments",
			label: "Attachments",
			icon: "attachment",
			count: card.attachments.length,
			iconOnly: false,
		},
	);
	if (mode === "view") {
		tabs.push({ key: "history", label: "History", icon: "history", count: null, iconOnly: true });
	}
	return tabs;
}

/**
 * Whether a tab hosts a side panel, and what that panel is for.
 *
 * Only two do, and they answer different questions: Details is being READ, so the panel carries the
 * recent activity that gives it context; Stages is being WORKED, so the panel carries the stage the
 * reader has selected. Everywhere else the content is the whole point — a submissions tree, a
 * breakdown table, a file grid — and a persistent column beside it would be taking width from the
 * thing the reader opened the tab for.
 */
export type TicketPanelKind = "activity" | "stage" | null;

export function panelFor(tab: TicketTab): TicketPanelKind {
	if (tab === "details") return "activity";
	if (tab === "stages") return "stage";
	return null;
}
// #endregion

// #region Submission projections (ticket-scoped)
/** Every `unit` node under a tree, depth-first. */
export function submissionUnits(tree: readonly SubmissionTreeNode[]): SubmissionTreeNode[] {
	const out: SubmissionTreeNode[] = [];
	const walk = (nodes: readonly SubmissionTreeNode[]) => {
		for (const n of nodes) {
			if (n.kind === "unit") out.push(n);
			else walk(n.children);
		}
	};
	walk(tree);
	return out;
}

/** How many submissions have been made against the ticket. */
export function countUnits(tree: readonly SubmissionTreeNode[]): number {
	return submissionUnits(tree).length;
}

/** Resolve the node a segment path addresses; `null` for the root or an unknown segment. */
export function nodeAtPath(
	tree: readonly SubmissionTreeNode[],
	path: readonly string[],
): SubmissionTreeNode | null {
	let nodes: readonly SubmissionTreeNode[] = tree;
	let found: SubmissionTreeNode | null = null;
	for (const segment of path) {
		const next = nodes.find((n) => n.segment === segment);
		if (!next) return found;
		found = next;
		nodes = next.children;
	}
	return found;
}

/** The direct children of the node a path addresses (the roots at the ticket's own root). */
export function childrenAtPath(
	tree: readonly SubmissionTreeNode[],
	path: readonly string[],
): SubmissionTreeNode[] {
	const node = nodeAtPath(tree, path);
	return node ? node.children : [...tree];
}

/** The files delivered under one node, addressed by its path. */
export function filesAtPath(card: BoardCard, path: readonly string[]): FileItem[] {
	const match = card.submissionFiles.find(
		(f) => f.path.length === path.length && f.path.every((s, i) => s === path[i]),
	);
	return match ? match.files : [];
}

/**
 * The path of the FIRST unit at or under a node — what "open this submission" resolves to when the
 * viewer clicks a stage or a submitter rather than a unit itself.
 */
export function firstUnitUnder(
	tree: readonly SubmissionTreeNode[],
	path: readonly string[],
): string[] {
	const start = nodeAtPath(tree, path);
	if (start?.kind === "unit") return [...path];
	const walk = (nodes: readonly SubmissionTreeNode[], prefix: string[]): string[] | null => {
		for (const n of nodes) {
			const next = [...prefix, n.segment];
			if (n.kind === "unit") return next;
			const deeper = walk(n.children, next);
			if (deeper) return deeper;
		}
		return null;
	};
	return walk(start ? start.children : tree, [...path]) ?? [...path];
}

/**
 * The canonical deep link for a submission unit inside a ticket:
 * `/projects/{projectId}/submissions/{stageId}/{submitterId}/{submissionId}`.
 *
 * The ticket's own tree is built stage → submitter → unit precisely so a node path IS this URL's
 * tail — the ticket modal and the Submissions explorer address the same node the same way, and
 * neither has to translate for the other.
 */
export function ticketSubmissionHref(
	projectId: string,
	path: readonly string[],
	opts: { review?: boolean } = {},
): string {
	const base = `/projects/${encodeURIComponent(projectId)}/submissions`;
	const url = path.length === 0
		? base
		: `${base}/${path.map((s) => encodeURIComponent(s)).join("/")}`;
	// The marker is what makes a copied review link REOPEN the review rather than merely land on the
	// submission. A bare deep link stays a navigation — auto-opening a modal on every arrival would
	// hijack a viewer who only wanted to look at the files.
	return opts.review ? `${url}${REVIEW_PARAM}` : url;
}

/** The query marker that asks the Submissions explorer to open its review workspace on arrival. */
export const REVIEW_PARAM = "?review=1";

/** Whether a location's search string carries the review marker. */
export function wantsReview(search: string): boolean {
	return new URLSearchParams(search).get("review") === "1";
}

/**
 * Build the review projection for a unit from the ticket's own data.
 *
 * Deliberately assembled client-side rather than fetched: every fact the review workspace needs
 * about the stage and the ticket is already on the card the viewer is looking at, and a second read
 * would introduce a window in which the modal and the ticket behind it disagree about the same
 * submission. `null` when the path does not resolve to a unit.
 */
export function reviewForPath(
	card: BoardCard,
	path: readonly string[],
): SubmissionReview | null {
	const unit = nodeAtPath(card.submissions, path);
	if (!unit || unit.kind !== "unit") return null;

	// A unit's path is [stage, submitter, unit] — the stage is its first segment.
	const stageRef = card.stages.find((s) => s.stageId === path[0]) ?? null;
	const submitterNode = nodeAtPath(card.submissions, path.slice(0, 2));
	const submitter = submitterNode ?? unit;
	const files = filesAtPath(card, path);

	return {
		unit: {
			path: [...path],
			name: unit.label,
			kind: "custom",
			status: unit.status ?? "pending_review",
			submitter: {
				id: submitter.handle ?? submitter.label,
				name: submitter.label,
				avatar: submitter.avatar ?? null,
				handle: submitter.handle ?? null,
			},
			stageId: stageRef?.stageId ?? null,
			stageName: stageRef?.name ?? null,
			ticketId: card.id,
			ticketTitle: card.title,
			createdAt: card.updatedAt,
			dateLabel: card.dateLabel,
			fileCount: files.length,
			noteCount: 0,
		},
		stageName: stageRef?.name ?? null,
		stageStatus: stageRef?.status ?? null,
		stageSummary: stageRef?.brief ||
			"No brief was written for this stage on this ticket.",
		ticketTitle: card.title,
		ticketSummary: card.description ??
			"This ticket has no description yet.",
		notes: [],
	};
}
// #endregion

// #region Footer figures
/**
 * The two money figures the footer leads with.
 *
 * They are lifted out of the badge row deliberately. What a ticket costs and what it has actually
 * cost so far are the two facts a client checks before every decision on this surface, and a
 * currency figure sitting in a row of counts reads as one more count. `spent` is what has genuinely
 * left the client — settled releases and fees, never a held escrow, which is the client's own money
 * ring-fenced against work nobody has accepted yet.
 */
export interface TicketMoney {
	totalCents: number | null;
	/** Pre-formatted total; `null` when no selected stage is priced (never "$0"). */
	totalLabel: string | null;
	spentCents: number;
	spentLabel: string;
	/** `0`–`1` — how much of the price has settled; `null` when there is no price to be a share of. */
	spentShare: number | null;
}

export function ticketMoney(card: BoardCard): TicketMoney {
	const spentCents = ticketSpentCents(card.payments);
	return {
		totalCents: card.budgetCents,
		totalLabel: card.budgetCents === null ? null : formatTicketMoney(card.budgetCents),
		spentCents,
		spentLabel: formatTicketMoney(spentCents),
		spentShare: card.budgetCents === null || card.budgetCents === 0
			? null
			: Math.min(1, spentCents / card.budgetCents),
	};
}

/** One icon-first metric badge in the modal footer, after the money. */
export interface TicketMetric {
	key: "submissions" | "updates" | "stages" | "attachments";
	icon: IconName;
	/** The figure itself — the badge's whole content beside the glyph. */
	value: string;
	/** What it counts, for the accessible name and the tooltip. */
	label: string;
	/** The tab clicking it opens; `null` for a read-only figure. */
	target: TicketTab | null;
	/** Whether the figure is currently non-zero and worth drawing attention to. */
	active: boolean;
}

/**
 * The footer's badges, in a fixed order so their positions are learnable. Money is NOT among them —
 * it leads the footer as its own pair of figures ({@link ticketMoney}).
 *
 * `mode` filters the same way the tab strip does: a badge that opens a tab which does not exist on a
 * ticket being created would be a control that cannot be used.
 */
export function ticketMetrics(card: BoardCard, mode: TicketMode = "view"): TicketMetric[] {
	const submissions = countUnits(card.submissions);
	const out: TicketMetric[] = [
		{
			key: "stages",
			icon: "stages",
			value: String(card.stages.length),
			label: `${card.stages.length} ${card.stages.length === 1 ? "stage" : "stages"}`,
			target: "stages",
			active: card.stages.length > 0,
		},
		{
			key: "attachments",
			icon: "attachment",
			value: String(card.attachments.length),
			label: `${card.attachments.length} ${
				card.attachments.length === 1 ? "attachment" : "attachments"
			}`,
			target: "attachments",
			active: card.attachments.length > 0,
		},
	];
	if (mode === "view") {
		out.unshift({
			key: "submissions",
			icon: "submission",
			value: String(submissions),
			label: `${submissions} ${submissions === 1 ? "submission" : "submissions"}`,
			target: "submissions",
			active: submissions > 0,
		});
		out.push({
			key: "updates",
			icon: "history",
			value: String(card.unreadCount),
			label: `${card.unreadCount} unread ${card.unreadCount === 1 ? "update" : "updates"}`,
			target: "history",
			active: card.unreadCount > 0,
		});
	}
	return out;
}
// #endregion

// #region Stage resolution (for the right panel, the Stages tab and the pipeline editor)
/** A ticket stage joined to the live board stage, with its band, price and capacity resolved. */
export interface TicketStageView {
	ref: TicketStageRef;
	/** The engagement's own record of the stage; `null` when it has since been removed. */
	stage: BoardStageRef | null;
	/** Position in the ticket's own order. */
	index: number;
	/** 0-based execution band — stages sharing a band start together. */
	band: number;
	/** Whether this stage opens its band (the numbered step) or continues one. */
	opensBand: boolean;
	/** Cost in minor units at the captured rate and the chosen difficulty; `null` when unpriced. */
	costCents: number | null;
	/** The $W_i$ this stage consumes at the chosen multiplier. */
	workload: number;
}

/**
 * Join a ticket's stage refs to the board's live stage records, in the ticket's own order, with
 * execution bands and money resolved.
 *
 * The ticket's captured facts (brief, intensity, tasks, base rate) always win; the live record
 * supplies only what the ticket never captured — the roster, the routing, the cap, the weight. Cost
 * is RE-DERIVED from the captured base rate rather than read off the stored figure, for the same
 * reason the Finances tab re-derives it: a surface that edits the intensity must re-price in the
 * same breath, and a stored total that lags the control the reader just moved is worse than no
 * total at all.
 */
export function resolveTicketStages(
	card: BoardCard,
	stages: readonly BoardStageRef[],
): TicketStageView[] {
	const byId = new Map(stages.map((s) => [s.id, s]));
	const ordered = [...card.stages].sort((a, b) => a.order - b.order);
	const bands = executionBands(ordered);
	const bandOf = new Map<string, number>();
	bands.forEach((band, i) => band.forEach((s) => bandOf.set(s.stageId, i)));

	return ordered.map((ref, i) => {
		const band = bandOf.get(ref.stageId) ?? i;
		const stage = byId.get(ref.stageId) ?? null;
		return {
			ref,
			stage,
			index: i,
			band,
			opensBand: i === 0 || (bandOf.get(ordered[i - 1].stageId) ?? i - 1) !== band,
			costCents: ref.unitPriceCents === null
				? ref.costCents
				: stageCostCents(ref.unitPriceCents, ref.intensity),
			workload: workloadIntensity(stage?.categoryWeight ?? 1, ref.intensity),
		};
	});
}

/**
 * Which stages are ACTIVE for this ticket — the ones a submission would go against right now.
 *
 * The ticket's status decides it, not the stage's: a claimed ticket is being worked in the stage it
 * currently sits in, and everything before that is done. A ticket that has not been routed to a
 * stage yet has no active stage, and a completed one has none either.
 */
export function activeStagesFor(card: BoardCard): TicketStageRef[] {
	if (card.status === "completed" || card.status === "cancelled") return [];
	const ordered = [...card.stages].sort((a, b) => a.order - b.order);
	if (card.stageId) {
		const current = ordered.find((s) => s.stageId === card.stageId);
		if (!current) return ordered.slice(0, 1);
		// Everything in the same execution band is running at the same time, so all of it is active.
		const bands = executionBands(ordered);
		return bands.find((b) => b.some((s) => s.stageId === current.stageId)) ?? [current];
	}
	return [];
}
// #endregion

// #region Labels
/** `$1,225` / `Not priced` — the one money string the modal shows for a possibly-unpriced figure. */
export function moneyOrDash(cents: number | null): string {
	return cents === null ? "Not priced" : formatTicketMoney(cents);
}

/** `×0.5` — the multiplier as ARITHMETIC, for the Finances tab only. Never a badge label. */
export function multiplierLabel(multiplier: number): string {
	return `×${multiplier % 1 === 0 ? multiplier : multiplier.toFixed(1)}`;
}
// #endregion
