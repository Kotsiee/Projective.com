import { z } from "zod";
import { formatMoney, type MoneyView, MoneyViewSchema } from "../finance/wallet.ts";
import { WorkspaceViewer } from "./access.ts";
import type { BoardCard, BoardPage, BoardStageRef } from "./board.ts";
import type { MemberRosterPage } from "./members.ts";
import { type ProjectOverview, ProjectOverviewSchema } from "./overview.ts";
import { pricedAtProjectLevel, pricedStages, type ProjectSetup } from "./setup.ts";
import type { ProjectStatus } from "./summary.ts";

/**
 * projects.workspace — the Zod SSOT for the engagement's **Overview** (`/projects/[slug]`), and the
 * one pure rule that composes it (Decision #144).
 *
 * The Overview is the command center for the people working on an engagement: what needs me, where
 * each stage stands, who is here. It is COMPOSED rather than read, from projections that already have
 * a live branch and a fixture branch — {@link ProjectOverviewSchema} (hero · updates · rooms · the
 * viewer's assignments · the viewer's money), the board (the stage run and every ticket's state), the
 * roster (people and open applications) and, for the owner, the setup (what each stage is priced at).
 * Composing means no second implementation of any of those reads, and it means the composition is a
 * pure function this module can test without a database.
 *
 * ## Viewer-pertinence carries over
 *
 * The base overview's rule — "every field is viewer-pertinent by construction" — holds here too, and
 * it decides two fields. A stage's PRICE is shown to the owner only: it is what the client is paying,
 * and a freelancer on one stage is owed nothing about the commercials of another. A stage's TICKET
 * COUNTS are shown to a participant only on the stages they are seated on: the board read is already
 * narrowed to those (a provider sees what they are paid and seated for), so a count on any other stage
 * would be a count of what the read withheld — a confident zero that is not true.
 *
 * Like its siblings this is a read projection, not a table row.
 */

// #region Next actions
/**
 * What the viewer could do next, most pressing first.
 *
 * Owner: `review_submissions` (work waiting on the client — it blocks a freelancer's payment, so it
 * leads) · `decide_applications` · `set_pricing` (a published brief with unpriced stages cannot staff
 * them). Participant: `revise_work` (a submission the client sent back) · `deliver_work` (claimed or
 * in-progress tickets).
 */
export const NextActionKind = z.enum([
	"review_submissions",
	"decide_applications",
	"set_pricing",
	"revise_work",
	"deliver_work",
]);
export type NextActionKind = z.infer<typeof NextActionKind>;

/** One row of "Needs you": a verb phrase, how many things it covers, and where it is done. */
export const NextActionSchema = z.object({
	kind: NextActionKind,
	/** How many items the row stands for — always at least one, or the row is not drawn. */
	count: z.number().int().min(1),
	/** The verb phrase, already pluralised ("Review 3 submissions"). */
	label: z.string().min(1).max(160),
	/** What it concerns when that is one thing — a stage or a ticket title — else `null`. */
	context: z.string().max(200).nullable(),
	/** The page where the action is taken. */
	href: z.string().min(1).max(300),
});
export type NextAction = z.infer<typeof NextActionSchema>;

/** The most rows "Needs you" carries. Five kinds exist, so this never truncates a real list. */
export const MAX_NEXT_ACTIONS = 8;
// #endregion

// #region Stage run
/**
 * A stage's place in the run, from its lifecycle status.
 *
 * `open` (not started, still staffing) · `in_progress` · `on_hold` · `delivered` · `cancelled`. The
 * stage's own status decides, not its ticket counts: a participant cannot see other stages' tickets,
 * and a state derived from a count they cannot see would differ by viewer for one stage.
 */
export const WorkspaceStageState = z.enum([
	"open",
	"in_progress",
	"on_hold",
	"delivered",
	"cancelled",
]);
export type WorkspaceStageState = z.infer<typeof WorkspaceStageState>;

/** The human label for each {@link WorkspaceStageState}. */
export const WORKSPACE_STAGE_STATE_LABEL: Readonly<Record<WorkspaceStageState, string>> = {
	open: "Open",
	in_progress: "In progress",
	on_hold: "On hold",
	delivered: "Delivered",
	cancelled: "Cancelled",
};

/** One stage on the Overview's run. */
export const WorkspaceStageSchema = z.object({
	/** The stage's row id — the join key with the board's cards and the setup's prices. */
	id: z.string().min(1).max(80),
	name: z.string().min(1).max(120),
	/** 1-based position in the run. */
	ordinal: z.number().int().min(1),
	state: WorkspaceStageState,
	/** Whether the viewer is seated on this stage. Always `false` for the owner, who is on none. */
	mine: z.boolean(),
	/**
	 * Delivered and total tickets, or `null` where the viewer is not owed the count (a participant on a
	 * stage they are not seated on) or the board could not be read.
	 */
	tickets: z.object({ done: z.number().int().min(0), total: z.number().int().min(0) }).nullable(),
	/** The stage's price, for the owner only; `null` for a participant or an unpriced stage. */
	price: MoneyViewSchema.nullable(),
	/** Whether {@link price} is per ticket (a pipeline) rather than the stage's own figure. */
	perTicket: z.boolean(),
	/** The owner's stage that still has no price, so cannot be staffed. Always `false` otherwise. */
	needsPrice: z.boolean(),
	/** The stage's room. */
	href: z.string().min(1).max(300),
});
export type WorkspaceStage = z.infer<typeof WorkspaceStageSchema>;
// #endregion

// #region People
/**
 * Who is on the engagement, and what is waiting at its door.
 *
 * `count` is the roster's own `total` — the whole team, deliberately not narrowed to the rows this
 * viewer's role may list — so it states the team's size truthfully. The two queues are a management
 * concern and are zero for anybody who cannot act on them.
 */
export const WorkspacePeopleSchema = z.object({
	count: z.number().int().min(0),
	pendingRequests: z.number().int().min(0),
	pendingInvitations: z.number().int().min(0),
});
export type WorkspacePeople = z.infer<typeof WorkspacePeopleSchema>;
// #endregion

// #region Envelope
/** The whole Overview read: the base overview plus what the composition adds. */
export const ProjectWorkspaceSchema = ProjectOverviewSchema.extend({
	/** Which of the two Overviews this is. */
	viewer: WorkspaceViewer,
	nextActions: z.array(NextActionSchema).max(MAX_NEXT_ACTIONS),
	/** The run in order. Empty for a Task (its one stage IS the Task) or when no stage is readable. */
	stages: z.array(WorkspaceStageSchema).max(50),
	/** `null` when the roster could not be read — an unknown count is not drawn as zero. */
	people: WorkspacePeopleSchema.nullable(),
});
export type ProjectWorkspace = z.infer<typeof ProjectWorkspaceSchema>;
// #endregion

// #region Composition
/** The reads the Overview is composed from. Each may be `null` when its read failed. */
export interface WorkspaceSources {
	viewer: WorkspaceViewer;
	board: BoardPage | null;
	/** The owner's configuration — read for the owner only, since only the owner is shown prices. */
	setup: ProjectSetup | null;
	roster: MemberRosterPage | null;
}

/** Tickets that are no longer part of the work: withdrawn, or hidden after a report. */
const OUT_OF_RUN: ReadonlySet<BoardCard["status"]> = new Set(["cancelled", "reported_hidden"]);

/** Tickets a participant is actively working: claimed, or under way. */
const WORKING: ReadonlySet<string> = new Set(["claimed", "in_progress"]);

function stateOf(status: ProjectStatus): WorkspaceStageState {
	switch (status) {
		case "draft":
			return "open";
		case "active":
			return "in_progress";
		case "on_hold":
			return "on_hold";
		case "completed":
			return "delivered";
		case "cancelled":
			return "cancelled";
	}
}

function plural(count: number, one: string, many: (n: number) => string): string {
	return count === 1 ? one : many(count);
}

/** The single value every item shares, or `null` when they differ (or there are none). */
function soleValue<T>(items: readonly T[], pick: (item: T) => string | null): string | null {
	let found: string | null = null;
	for (const item of items) {
		const value = pick(item);
		if (value === null) return null;
		if (found !== null && found !== value) return null;
		found = value;
	}
	return found;
}

function clampText(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The stage's price as a {@link MoneyView}, server-formatted (Decision #55), or `null`. */
function moneyOf(minor: number | null, currency: string): MoneyView | null {
	if (minor === null) return null;
	return { minor, currency, display: formatMoney(minor, currency), origin: null };
}

/**
 * The run, ordered, with each stage's state, the viewer's seat, the counts they are owed and — for the
 * owner — the price and whether one is missing.
 *
 * A Task has no run: its one stage IS the Task, and a single row restating the page's own title tells
 * the reader nothing. The setup's prices are joined by stage id, falling back to the name, because the
 * two reads are separate projections and nothing guarantees one shares the other's key.
 */
function stageRun(slug: string, sources: WorkspaceSources): WorkspaceStage[] {
	const { board, setup, viewer } = sources;
	if (!board || board.structure === "single_task") return [];

	// Only the stages the ladder asks to be priced — the same rule `pricingSatisfied` applies — so the
	// Overview and the setup ladder cannot disagree about which stage "needs a price".
	const priced = setup ? pricedStages(setup.structure, setup.stages) : [];
	const pricedByName = new Map(priced.map((s) => [s.name.trim().toLowerCase(), s]));
	const seated = new Set(board.viewerStageIds);
	const currency = setup?.budget.currency ?? "USD";
	const perTicket = (setup?.format ?? board.format) === "pipeline";

	const ordered = [...board.stages].sort((a, b) => a.order - b.order);
	return ordered.map((stage: BoardStageRef, index) => {
		const mine = viewer === "participant" && seated.has(stage.id);
		const owed = viewer === "owner" || mine;
		const cards = owed
			? board.cards.filter((card) => card.stageId === stage.id && !OUT_OF_RUN.has(card.status))
			: [];
		const setupStage = viewer === "owner"
			? priced.find((s) => s.id === stage.id) ?? pricedByName.get(stage.name.trim().toLowerCase())
			: undefined;
		return {
			id: stage.id,
			name: clampText(stage.name, 120),
			ordinal: index + 1,
			state: stateOf(stage.status),
			mine,
			tickets: owed
				? {
					done: cards.filter((card) => card.status === "completed").length,
					total: cards.length,
				}
				: null,
			price: setupStage ? moneyOf(setupStage.unitPriceCents, currency) : null,
			perTicket,
			needsPrice: setupStage !== undefined && setupStage.unitPriceCents === null,
			href: `/projects/${slug}/${encodeURIComponent(stage.slug)}`,
		};
	});
}

/** The owner's queue: review, then applications, then pricing. */
function ownerActions(
	slug: string,
	sources: WorkspaceSources,
	stages: readonly WorkspaceStage[],
): NextAction[] {
	const out: NextAction[] = [];
	const { board, setup, roster } = sources;

	const inReview = (board?.cards ?? []).filter((card) => card.status === "in_review");
	if (inReview.length > 0) {
		const stageNames = new Map((board?.stages ?? []).map((s) => [s.id, s.name]));
		out.push({
			kind: "review_submissions",
			count: inReview.length,
			label: plural(inReview.length, "Review a submission", (n) => `Review ${n} submissions`),
			context: soleValue(
				inReview,
				(card) => (card.stageId ? stageNames.get(card.stageId) ?? null : null),
			),
			href: `/projects/${slug}/submissions`,
		});
	}

	const applications = roster?.requests.length ?? 0;
	if (applications > 0) {
		out.push({
			kind: "decide_applications",
			count: applications,
			label: plural(applications, "Decide on an application", (n) => `Decide on ${n} applications`),
			context: null,
			href: `/projects/${slug}/members?view=requests`,
		});
	}

	const unpriced = stages.filter((stage) => stage.needsPrice);
	if (unpriced.length > 0) {
		out.push({
			kind: "set_pricing",
			count: unpriced.length,
			label: plural(unpriced.length, "Price a stage", (n) => `Price ${n} stages`),
			context: unpriced.length === 1 ? unpriced[0].name : null,
			href: `/projects/${slug}/details#psu-stages`,
		});
	} else if (setup && pricedAtProjectLevel(setup.structure) && setup.budget.amountCents === null) {
		out.push({
			kind: "set_pricing",
			count: 1,
			label: "Set the project price",
			context: null,
			href: `/projects/${slug}/details`,
		});
	}

	return out;
}

/** The participant's queue: work sent back first, then work in hand. */
function participantActions(
	slug: string,
	base: ProjectOverview,
	sources: WorkspaceSources,
): NextAction[] {
	const out: NextAction[] = [];
	const mine = new Set(base.assignments.map((a) => a.ticketId));
	const returned = (sources.board?.cards ?? []).filter((card) =>
		mine.has(card.id) && card.activity === "revision_requested"
	);
	const returnedIds = new Set(returned.map((card) => card.id));
	if (returned.length > 0) {
		out.push({
			kind: "revise_work",
			count: returned.length,
			label: plural(
				returned.length,
				"Revise returned work",
				(n) => `Revise ${n} returned submissions`,
			),
			context: returned.length === 1 ? clampText(returned[0].title, 200) : null,
			href: `/projects/${slug}/submissions`,
		});
	}

	const working = base.assignments.filter((a) =>
		WORKING.has(a.status) && !returnedIds.has(a.ticketId)
	);
	if (working.length > 0) {
		out.push({
			kind: "deliver_work",
			count: working.length,
			label: plural(working.length, "Submit your work", (n) => `Submit work on ${n} tickets`),
			context: working.length === 1 ? clampText(working[0].title, 200) : null,
			href: `/projects/${slug}/submissions`,
		});
	}

	return out;
}

/**
 * Compose the Overview from its sources.
 *
 * Pure and total: a source that failed arrives as `null` and its part of the page degrades to
 * "unknown" (no run, no people, fewer actions) rather than to a confident zero.
 */
export function composeWorkspace(
	base: ProjectOverview,
	sources: WorkspaceSources,
): ProjectWorkspace {
	const slug = base.slug;
	const stages = stageRun(slug, sources);
	const nextActions = sources.viewer === "owner"
		? ownerActions(slug, sources, stages)
		: participantActions(slug, base, sources);
	const roster = sources.roster;
	return {
		...base,
		viewer: sources.viewer,
		nextActions: nextActions.slice(0, MAX_NEXT_ACTIONS),
		stages,
		people: roster
			? {
				count: roster.total,
				pendingRequests: roster.requests.length,
				pendingInvitations: roster.invites.filter((invite) => invite.status === "pending").length,
			}
			: null,
	};
}
// #endregion
