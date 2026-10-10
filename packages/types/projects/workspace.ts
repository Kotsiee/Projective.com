import { z } from "zod";
import { formatMoney, type MoneyView, MoneyViewSchema } from "../finance/wallet.ts";
import { flattenRichText } from "../richtext/plain-text.ts";
import { WorkspaceViewer } from "./access.ts";
import {
	type BoardCard,
	type BoardPage,
	type BoardStageRef,
	TICKET_INTENSITY_LABEL,
} from "./board.ts";
import type { MemberRosterPage } from "./members.ts";
import { type ProjectOverview, ProjectOverviewSchema } from "./overview.ts";
import {
	isTaskProject,
	pricedAtProjectLevel,
	pricedStages,
	PROJECT_TYPE_LABEL,
	type ProjectRules,
	type ProjectSetup,
	projectTypeOf,
} from "./setup.ts";
import type {
	SubmissionListPage,
	SubmissionStatus,
	SubmissionTreeNode,
} from "./submissions.ts";
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

// #region Brief
/** One operational term a freelancer is hired under ("IP ownership" · "Exclusive transfer"). */
export const WorkspaceTermSchema = z.object({
	label: z.string().min(1).max(60),
	value: z.string().min(1).max(200),
});
export type WorkspaceTerm = z.infer<typeof WorkspaceTermSchema>;

/**
 * What the engagement is and the terms it is run under — the brief every person on it works against.
 * Composed from the configuration, so it says exactly what the owner configured; prices are absent
 * except the budget model's headline figure, which a hire already saw on the listing.
 */
export const WorkspaceBriefSchema = z.object({
	/** The description as plain prose paragraphs (never rendered as HTML on the Overview). */
	description: z.string().max(8000),
	/** "Task" · "One-off" · "Pipeline" · "Session" · "Group session". */
	formatLabel: z.string().min(1).max(40),
	/** The skills the stages ask for, deduplicated, in stage order. */
	tags: z.array(z.string().min(1).max(60)).max(12),
	/** The latest delivery date across the stages ("Due Fri, 12 Sep"), or `null` when undated. */
	deadlineLabel: z.string().max(40).nullable(),
	/** "Fixed price · $4,000" / "Hourly cap · $60" / the model alone when unpriced. */
	budgetLabel: z.string().min(1).max(80),
	/** The NDA the work is under: none, the platform standard, or the client's own document. */
	nda: z.object({
		required: z.boolean(),
		source: z.enum(["none", "platform", "custom"]),
		label: z.string().min(1).max(80),
	}),
	terms: z.array(WorkspaceTermSchema).max(10),
});
export type WorkspaceBrief = z.infer<typeof WorkspaceBriefSchema>;
// #endregion

// #region People roster
/** The three sides a person stands on in the People list. */
export const WorkspacePersonRole = z.enum(["owner", "client_member", "freelancer"]);
export type WorkspacePersonRole = z.infer<typeof WorkspacePersonRole>;

export const WORKSPACE_PERSON_ROLE_LABEL: Readonly<Record<WorkspacePersonRole, string>> = {
	owner: "Owner",
	client_member: "Client member",
	freelancer: "Freelancer",
};

/** One person on the engagement, as the Overview's People list shows them. */
export const WorkspacePersonSchema = z.object({
	id: z.string().min(1).max(120),
	name: z.string().min(1).max(120),
	handle: z.string().max(40).nullable(),
	avatar: z.string().max(400).nullable(),
	role: WorkspacePersonRole,
	/** The stages they deliver on, joined ("Discovery, Concepts"); `null` on a Task or with none. */
	stages: z.string().max(200).nullable(),
	/** The hired team they are seated through, or `null`. */
	team: z.string().max(120).nullable(),
	/** Their membership of the paying business and their corporate role there, or `null`. */
	business: z.object({ name: z.string().min(1).max(120), role: z.string().min(1).max(60) })
		.nullable(),
	isViewer: z.boolean(),
});
export type WorkspacePerson = z.infer<typeof WorkspacePersonSchema>;

/** The most people the Overview lists before "everyone" is the Members page's job. */
export const MAX_WORKSPACE_PEOPLE = 12;
// #endregion

// #region Freelancer work signals
/** A deliverable's review state, worded for the freelancer. */
export const WorkspaceSubmissionState = z.enum(["pending_review", "in_revision", "approved"]);
export type WorkspaceSubmissionState = z.infer<typeof WorkspaceSubmissionState>;

export const WORKSPACE_SUBMISSION_STATE_LABEL: Readonly<Record<WorkspaceSubmissionState, string>> = {
	pending_review: "Pending review",
	in_revision: "In revision",
	approved: "Approved",
};

/** One of the viewer's own recent deliverables and where its review stands. */
export const WorkspaceSubmissionSchema = z.object({
	id: z.string().min(1).max(400),
	title: z.string().min(1).max(200),
	stageName: z.string().max(120).nullable(),
	state: WorkspaceSubmissionState,
	href: z.string().min(1).max(600),
});
export type WorkspaceSubmission = z.infer<typeof WorkspaceSubmissionSchema>;

/** A ready ticket the viewer may claim now without breaching their workload cap. */
export const WorkspaceClaimableSchema = z.object({
	ticketId: z.string().min(1).max(120),
	title: z.string().min(1).max(200),
	stageName: z.string().max(120).nullable(),
	/** "Standard · 1 unit of capacity" — what claiming it costs the viewer's W_i budget. */
	loadLabel: z.string().min(1).max(60),
	dueLabel: z.string().max(28).nullable(),
	href: z.string().min(1).max(300),
});
export type WorkspaceClaimable = z.infer<typeof WorkspaceClaimableSchema>;

/** How many rows each work-signal list carries. */
export const MAX_WORK_SIGNALS = 6;
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
	/** `null` when the configuration could not be read. */
	brief: WorkspaceBriefSchema.nullable().default(null),
	/** Whether the engagement is a Task — the People list then names no stage. */
	task: z.boolean().default(false),
	/** The people on the engagement, owner first; empty when the roster could not be read. */
	roster: z.array(WorkspacePersonSchema).max(MAX_WORKSPACE_PEOPLE).default([]),
	/** The viewer's own recent deliverables — participant only; empty for the owner. */
	submissions: z.array(WorkspaceSubmissionSchema).max(MAX_WORK_SIGNALS).default([]),
	/** Tickets ready for an open claim within the viewer's capacity — participant only. */
	claimable: z.array(WorkspaceClaimableSchema).max(MAX_WORK_SIGNALS).default([]),
});
export type ProjectWorkspace = z.infer<typeof ProjectWorkspaceSchema>;
// #endregion

// #region Composition
/** The reads the Overview is composed from. Each may be `null` when its read failed. */
export interface WorkspaceSources {
	viewer: WorkspaceViewer;
	board: BoardPage | null;
	/**
	 * The configuration. Read for every viewer, because the brief is composed from it — but only the
	 * owner's composition reads its PRICES ({@link stageRun}, {@link ownerActions}); a participant's
	 * takes the brief alone.
	 */
	setup: ProjectSetup | null;
	roster: MemberRosterPage | null;
	/** The viewer's own submissions (`asFreelancer`) — read for a participant only. */
	submissions?: SubmissionListPage | null;
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** `Due Fri, 12 Sep` from UTC components, so SSR and a refetch cannot disagree by a timezone. */
function dueLabelOf(ms: number): string {
	const d = new Date(ms);
	return `Due ${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

const IP_OWNERSHIP_LABEL: Readonly<Record<ProjectRules["ipOwnershipMode"], string>> = {
	exclusive_transfer: "Transferred exclusively to the client",
	licensed_use: "Licensed for the client's use",
	shared_ownership: "Shared between client and freelancer",
	projective_partner: "Projective partner terms",
};

const PORTFOLIO_LABEL: Readonly<Record<ProjectRules["portfolioDisplayRights"], string>> = {
	allowed: "May be shown in a portfolio",
	forbidden: "May not be shown publicly",
	embargoed: "May be shown after an embargo",
};

/** The type's name on the Overview — the setup selector's words, plus the two session kinds. */
function formatLabelOf(setup: ProjectSetup): string {
	if (setup.format === "session") return setup.sessionKind === "group" ? "Group session" : "Session";
	const type = projectTypeOf(setup.format, setup.structure);
	return type ? PROJECT_TYPE_LABEL[type] : "Project";
}

/**
 * The brief, from the configuration. Every line is something the owner configured; nothing is
 * inferred. The description is flattened to prose: the Overview renders text, never stored HTML.
 */
export function briefOf(setup: ProjectSetup): WorkspaceBrief {
	const tags: string[] = [];
	const seen = new Set<string>();
	const skills = [
		...[...setup.stages].sort((a, b) => a.order - b.order).flatMap((stage) => stage.skills),
		...setup.roles.flatMap((role) => role.skills),
	];
	for (const skill of skills) {
		const key = skill.trim().toLowerCase();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		tags.push(clampText(skill.trim(), 60));
	}

	let latest: number | null = null;
	for (const stage of setup.stages) {
		const at = stage.deliveryDate ? Date.parse(stage.deliveryDate) : Number.NaN;
		if (!Number.isNaN(at) && (latest === null || at > latest)) latest = at;
	}

	const model = setup.budget.budgetType === "hourly_cap" ? "Hourly cap" : "Fixed price";
	const amount = setup.budget.amountCents;

	const rules = setup.rules;
	const nda: WorkspaceBrief["nda"] = !rules.ndaRequired
		? { required: false, source: "none", label: "No NDA" }
		: rules.ndaSource === "custom"
		? { required: true, source: "custom", label: "Custom NDA from the client" }
		: { required: true, source: "platform", label: "Projective standard NDA" };

	const terms: WorkspaceTerm[] = [
		{ label: "IP ownership", value: IP_OWNERSHIP_LABEL[rules.ipOwnershipMode] },
		{ label: "Portfolio", value: PORTFOLIO_LABEL[rules.portfolioDisplayRights] },
		{
			label: "Location",
			value: rules.locationRestriction.length > 0
				? clampText(rules.locationRestriction.join(", "), 200)
				: "Anywhere",
		},
		{
			label: "Languages",
			value: rules.languageRequirement.length > 0
				? clampText(rules.languageRequirement.join(", "), 200)
				: "No requirement",
		},
	];
	if (rules.allowDeadlineBonuses) {
		terms.push({ label: "Deadline bonuses", value: "Offered for early delivery" });
	}

	return {
		description: clampText(flattenRichText(setup.description).trim(), 8000),
		formatLabel: formatLabelOf(setup),
		tags: tags.slice(0, 12),
		deadlineLabel: latest === null ? null : dueLabelOf(latest),
		budgetLabel: amount === null
			? model
			: clampText(`${model} · ${formatMoney(amount, setup.budget.currency)}`, 80),
		nda,
		terms,
	};
}

const CLIENT_SIDE_ROLES: ReadonlySet<string> = new Set(["client", "admin", "manager"]);
const FREELANCER_ROLES: ReadonlySet<string> = new Set(["freelancer", "member"]);

/**
 * The People list: owner, client members, freelancers — the roster's own order within each. A
 * `guest` is a read-limited observer, not a party to the work, and is left to the Members page.
 */
function rosterOf(roster: MemberRosterPage | null, task: boolean): WorkspacePerson[] {
	if (!roster) return [];
	const rank: Record<WorkspacePersonRole, number> = { owner: 0, client_member: 1, freelancer: 2 };
	const people: WorkspacePerson[] = [];
	for (const row of roster.members) {
		const role: WorkspacePersonRole | null = row.role === "owner"
			? "owner"
			: CLIENT_SIDE_ROLES.has(row.role)
			? "client_member"
			: FREELANCER_ROLES.has(row.role)
			? "freelancer"
			: null;
		if (!role) continue;
		people.push({
			id: row.id,
			name: clampText(row.party.name, 120),
			handle: row.party.handle,
			avatar: row.party.avatar,
			role,
			stages: !task && row.assignedStages.length > 0
				? clampText(row.assignedStages.join(", "), 200)
				: null,
			team: row.team?.name ?? null,
			business: row.business ?? null,
			isViewer: row.isViewer,
		});
	}
	return people
		.map((person, index) => ({ person, index }))
		.sort((a, b) => rank[a.person.role] - rank[b.person.role] || a.index - b.index)
		.map(({ person }) => person)
		.slice(0, MAX_WORKSPACE_PEOPLE);
}

const SUBMISSION_STATE: Partial<Record<SubmissionStatus, WorkspaceSubmissionState>> = {
	pending_review: "pending_review",
	revision_requested: "in_revision",
	accepted: "approved",
};

/**
 * The viewer's own deliverables, from their isolated submissions tree: every `unit` node that has been
 * sent, with the stage it sits under. Returned work leads, then work awaiting review, then approved.
 */
function submissionsOf(slug: string, page: SubmissionListPage | null | undefined): WorkspaceSubmission[] {
	if (!page) return [];
	const out: WorkspaceSubmission[] = [];
	const walk = (nodes: readonly SubmissionTreeNode[], path: string[], stage: string | null) => {
		for (const node of nodes) {
			const at = [...path, node.segment];
			const stageName = node.kind === "stage" ? node.label : stage;
			const state = node.kind === "unit" && node.status ? SUBMISSION_STATE[node.status] : undefined;
			if (state) {
				out.push({
					id: clampText(at.join("/"), 400),
					title: clampText(node.label, 200),
					stageName: stageName ? clampText(stageName, 120) : null,
					state,
					href: `/projects/${slug}/submissions/${at.map(encodeURIComponent).join("/")}`,
				});
			}
			walk(node.children, at, stageName);
		}
	};
	walk(page.tree, [], null);
	const order: Record<WorkspaceSubmissionState, number> = {
		in_revision: 0,
		pending_review: 1,
		approved: 2,
	};
	return out
		.map((item, index) => ({ item, index }))
		.sort((a, b) => order[a.item.state] - order[b.item.state] || a.index - b.index)
		.map(({ item }) => item)
		.slice(0, MAX_WORK_SIGNALS);
}

/** Ticket states that occupy a freelancer's workload capacity. */
const HOLDING: ReadonlySet<string> = new Set(["claimed", "in_progress", "in_review"]);

/**
 * Tickets the viewer could claim now: ready (`todo`), unclaimed, described (the purchasing gate), on a
 * stage they are seated on whose routing is an open pull — and that fit under the stage's cap on
 * summed W_i once the work the viewer already holds there is counted. The board read is already
 * narrowed to what a provider may see (paid, onboarded), so nothing here widens it.
 */
function claimableOf(slug: string, base: ProjectOverview, board: BoardPage | null): WorkspaceClaimable[] {
	if (!board) return [];
	const seated = new Set(board.viewerStageIds);
	const mine = new Set(base.assignments.map((a) => a.ticketId));
	const stages = new Map(board.stages.map((stage) => [stage.id, stage]));
	const held = new Map<string, number>();
	for (const card of board.cards) {
		if (!card.stageId || !mine.has(card.id) || !HOLDING.has(card.status)) continue;
		held.set(card.stageId, (held.get(card.stageId) ?? 0) + card.workload);
	}
	const out: WorkspaceClaimable[] = [];
	for (const card of board.cards) {
		if (card.status !== "todo" || card.claimed || !card.hasDescription || !card.stageId) continue;
		if (!seated.has(card.stageId)) continue;
		const stage = stages.get(card.stageId);
		if (!stage || stage.assignmentMode !== "open_pull") continue;
		const cap = stage.maxConcurrentIntensity;
		if (cap !== null && (held.get(card.stageId) ?? 0) + card.workload > cap) continue;
		const units = card.workload === 1 ? "1 unit" : `${card.workload} units`;
		out.push({
			ticketId: card.id,
			title: clampText(card.title, 200),
			stageName: clampText(stage.name, 120),
			loadLabel: clampText(`${TICKET_INTENSITY_LABEL[card.intensity]} · ${units} of capacity`, 60),
			dueLabel: card.dueLabel,
			href: card.slug
				? `/projects/${slug}/board?tkv=${encodeURIComponent(card.slug)}`
				: `/projects/${slug}/board`,
		});
		if (out.length >= MAX_WORK_SIGNALS) break;
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
	const participant = sources.viewer === "participant";
	const task = sources.setup
		? isTaskProject(sources.setup.format, sources.setup.structure)
		: sources.board?.structure === "single_task";
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
		brief: sources.setup ? briefOf(sources.setup) : null,
		task,
		roster: rosterOf(roster, task),
		submissions: participant ? submissionsOf(slug, sources.submissions) : [],
		claimable: participant ? claimableOf(slug, base, sources.board) : [],
	};
}
// #endregion
