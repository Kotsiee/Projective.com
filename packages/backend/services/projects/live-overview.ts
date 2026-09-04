import { formatMoney, type MoneyView } from "@projective/types/finance";
import type {
	ChannelKind,
	ProjectAssignment,
	ProjectOverview,
	ProjectOverviewChannel,
	ProjectOverviewFinance,
	ProjectStatus,
	ProjectUpdate,
	SystemActivityType,
	TicketStatus,
} from "@projective/types/projects";
import type { ReadActor } from "../read-actor.ts";
import {
	clamp,
	clampOr,
	commsDb,
	DELIVERED_STAGE_STATUS,
	fetchParties,
	partyOf,
	type PartyRow,
	projectsDb,
	toTicketStatus,
} from "./live-support.ts";
import { UUID_RE } from "./project-identity.ts";

/**
 * live-overview — the RLS-scoped read behind the freelancer's `/projects/[projectId]` dashboard.
 *
 * The owner of an engagement gets the setup projection; everybody else gets this. Its rule is stated
 * once, in {@link ProjectOverviewSchema}, and enforced here: **every figure is the VIEWER's**. The
 * assignment list is scoped to `current_assignee_id = auth.uid()` in the query itself rather than
 * filtered afterwards, so a widening of the projection cannot quietly become a widening of the
 * disclosure.
 *
 * ## What comes back neutral, and why
 *
 * - **The money position is zero.** `authenticated` holds no `USAGE` on the `finance` schema
 *   (`00002500` revokes it and never re-grants — root CLAUDE.md §8 Decisions #68(a)/#83), so
 *   `finance.escrows` and `finance.transactions` are unreachable under the caller's own JWT. Zero is
 *   the honest rendering of "we could not ask": it is what the surface would show for a freelancer
 *   with no money on the engagement, and inventing a figure on a money surface is the one error
 *   nobody could detect. Granting the schema is an exposure decision, not a fix this read may make.
 * - **A channel's unread flag is `false` and its preview is empty.** `comms.project_channels` has no
 *   per-viewer read watermark and no denormalised last message; a preview would need one keyed query
 *   per room, and an unread state would need a column that does not exist.
 * - **The update rail carries only the activity kinds that mean the same thing on both sides.**
 *   `projects.project_activity.kind` is free text whose written values are `milestone_confirmed`,
 *   `seat_assigned`, `submission_reviewed` and `project_status_changed`; {@link SystemActivityType}
 *   has eight members and shares three of those meanings. An entry with no counterpart is DROPPED,
 *   because a rail reporting a status change as a closed ticket is worse than one that omits it.
 *
 * THROWS only on a genuine failure of a PRIMARY read (the project row), with the table named, so the
 * calling service can log it and fall back to fixtures. Every secondary lookup degrades to a neutral
 * value instead, so one withheld join cannot take down a dashboard that otherwise resolved.
 */

// #region Constants
/** How many rooms the quick-entry list carries before it stops being a shortcut. */
const CHANNEL_LIMIT = 8;

/** How many events the rail carries before it stops being "recent". */
const UPDATE_LIMIT = 12;

/** How many open tickets the "Your work" block lists. */
const ASSIGNMENT_LIMIT = 12;

/** Ticket states that are no longer owed, and therefore not work. */
const CLOSED_TICKET: ReadonlySet<string> = new Set(["completed", "cancelled"]);

/** The stage-room visibilities that are a private side-room rather than the shared stage channel. */
const PRIVATE_ROOM: ReadonlySet<string> = new Set(["team_private", "business_private"]);

/** Zod bounds this read clamps against, named so a widened schema is one edit rather than a search. */
const TITLE_MAX = 160;
const NAME_MAX = 120;
const UPDATE_TEXT_MAX = 240;
const HREF_MAX = 300;
// #endregion

// #region Row shapes
/** One `projects.projects` row, reduced to what the dashboard needs. */
interface ProjectRow {
	id: string;
	slug: string;
	title: string;
	status: string;
	currency: string | null;
	owner_user_id: string;
}

/** One `projects.project_stages` row — the progress meter's two numbers come from these. */
interface StageRow {
	id: string;
	name: string;
	status: string;
}

/** One `comms.project_channels` row. */
interface ChannelRow {
	id: string;
	name: string;
	stage_id: string | null;
	visibility: string;
	created_at: string;
}

/** One `projects.tickets` row assigned to the viewer. */
interface TicketRow {
	id: string;
	title: string;
	status: string;
	current_stage_id: string | null;
	due_date: string | null;
	updated_at: string;
}

/** One `projects.project_activity` row. */
interface ActivityRow {
	id: string;
	actor_user_id: string;
	kind: string;
	payload: Record<string, unknown> | null;
	created_at: string;
}
// #endregion

// #region Formatting
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * A short relative label — `atLabel` is `max(28)`.
 *
 * UTC components and fixed English names, never `Intl`: this string is produced on the server and
 * re-produced by the island on every refetch, so anything reading a local zone or a locale makes SSR
 * and hydration disagree about when something happened. The fixtures carry the same rule.
 */
function relativeLabel(iso: string, now: number): string {
	const at = Date.parse(iso);
	if (Number.isNaN(at)) return "";
	const delta = now - at;
	if (delta < HOUR_MS) return `${Math.max(1, Math.floor(delta / 60_000))}m ago`;
	if (delta < DAY_MS) return `${Math.floor(delta / HOUR_MS)}h ago`;
	const days = Math.floor(now / DAY_MS) - Math.floor(at / DAY_MS);
	if (days === 1) return "Yesterday";
	const d = new Date(at);
	return `${WD[d.getUTCDay()]}, ${MO[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** `Due Fri, 12 Sep` — `dueLabel` is `max(40)`. */
function dueLabel(iso: string): string {
	const at = Date.parse(iso);
	if (Number.isNaN(at)) return "";
	const d = new Date(at);
	return `Due ${WD[d.getUTCDay()]}, ${d.getUTCDate()} ${MO[d.getUTCMonth()]}`;
}

/** The lifecycle state in words — the one containered element on the identity row (§B.11). */
const STATUS_LABEL: Record<string, string> = {
	draft: "Draft",
	active: "Active",
	on_hold: "On hold",
	completed: "Completed",
	cancelled: "Cancelled",
	archived: "Archived",
};

/**
 * Coerce `project_status` onto the Zod {@link ProjectStatus}.
 *
 * The column carries an `archived` member the Zod enum does not, so an archived project degrades to
 * `cancelled` — the closest representable "no longer running" — while {@link STATUS_LABEL} still
 * prints the true word. A row that failed to parse would take the whole dashboard down instead.
 */
function toProjectStatus(raw: string): ProjectStatus {
	switch (raw) {
		case "draft":
		case "active":
		case "on_hold":
		case "completed":
		case "cancelled":
			return raw;
		default:
			return "cancelled";
	}
}
// #endregion

// #region Money
/**
 * The viewer's escrow position — see the module docblock on why it is zero.
 *
 * Built as a real {@link MoneyView} rather than omitted, because the field is required and the
 * surface renders three figures whichever way this resolves. The currency is the project's own, so
 * the moment the `finance` grant lands the only change here is the summation.
 */
function neutralFinance(currency: string): ProjectOverviewFinance {
	const zero: MoneyView = {
		minor: 0,
		currency,
		display: formatMoney(0, currency),
		origin: null,
	};
	return { escrowed: zero, released: zero, pending: zero };
}
// #endregion

// #region Vocabulary
/**
 * `projects.project_activity.kind` → {@link SystemActivityType}, where the two agree.
 *
 * Deliberately partial; see the module docblock. `submission_reviewed` is absent because the outcome
 * lives in the row's `payload.decision` and only one of its two values has a counterpart — that
 * branch is resolved in {@link activityOf} rather than by a table that cannot see the payload.
 */
const ACTIVITY_KIND: Record<string, SystemActivityType> = {
	milestone_confirmed: "ticket_closed",
	seat_assigned: "member_joined",
};

/** The human line for an activity kind. `min(1)`, so every branch returns real prose. */
function activityText(kind: SystemActivityType, actorName: string): string {
	switch (kind) {
		case "ticket_closed":
			return `${actorName} confirmed a milestone delivery.`;
		case "member_joined":
			return `${actorName} was assigned a seat on this project.`;
		case "revision_requested":
			return `${actorName} requested a revision on a submission.`;
		case "submission_made":
			return `${actorName} made a submission.`;
		case "stage_completed":
			return `${actorName} completed a stage.`;
		case "member_left":
			return `${actorName} left the project.`;
		case "payment_released":
			return `${actorName} released a payment.`;
		case "ticket_created":
			return `${actorName} created a ticket.`;
	}
}
// #endregion

// #region Queries
/** The project this route names, resolved from a slug or a uuid. */
async function fetchProject(
	actor: ReadActor & { accessToken: string },
	projectId: string,
): Promise<ProjectRow | null> {
	const base = projectsDb(actor)
		.from("projects")
		.select("id, slug, title, status, currency, owner_user_id");
	// A route segment is a slug, but a deep link or an internal caller may hand over the uuid. Matching
	// a slug against a uuid column raises `22P02 invalid input syntax` rather than returning nothing,
	// so the two are told apart before the predicate is chosen, not after it fails.
	const filtered = UUID_RE.test(projectId) ? base.eq("id", projectId) : base.eq("slug", projectId);
	const { data, error } = await filtered.maybeSingle();

	if (error) throw new Error(`projects.projects read failed: ${error.message}`);
	if (!data) return null;
	return data as unknown as ProjectRow;
}

/** Every stage on the project. A withheld read yields none, which reads as "no stage run". */
async function fetchStages(
	actor: ReadActor & { accessToken: string },
	projectId: string,
): Promise<StageRow[]> {
	const { data, error } = await projectsDb(actor)
		.from("project_stages")
		.select("id, name, status")
		.eq("project_id", projectId)
		.order("sort_order", { ascending: true });
	if (error) return [];
	return (data ?? []) as unknown as StageRow[];
}

/** The rooms the viewer can see. RLS decides which; this read adds no filter of its own. */
async function fetchChannels(
	actor: ReadActor & { accessToken: string },
	projectId: string,
): Promise<ChannelRow[]> {
	const { data, error } = await commsDb(actor)
		.from("project_channels")
		.select("id, name, stage_id, visibility, created_at")
		.eq("project_id", projectId)
		.order("created_at", { ascending: true });
	if (error) return [];
	return (data ?? []) as unknown as ChannelRow[];
}

/**
 * The viewer's OWN open tickets.
 *
 * Scoped in the query rather than filtered after it. RLS answers "may I see this project's tickets",
 * which for a participant is all of them; the dashboard asks the narrower question "which of these
 * are mine", and asking it in SQL means a later change to this projection cannot accidentally widen
 * what leaves the server.
 */
async function fetchAssignments(
	actor: ReadActor & { accessToken: string },
	projectId: string,
): Promise<TicketRow[]> {
	const { data, error } = await projectsDb(actor)
		.from("tickets")
		.select("id, title, status, current_stage_id, due_date, updated_at")
		.eq("project_id", projectId)
		.eq("current_assignee_id", actor.userId)
		.order("updated_at", { ascending: false })
		.limit(ASSIGNMENT_LIMIT * 2);
	if (error) return [];
	return (data ?? []) as unknown as TicketRow[];
}

/** The project's activity feed, newest first. */
async function fetchActivity(
	actor: ReadActor & { accessToken: string },
	projectId: string,
): Promise<ActivityRow[]> {
	const { data, error } = await projectsDb(actor)
		.from("project_activity")
		.select("id, actor_user_id, kind, payload, created_at")
		.eq("project_id", projectId)
		.order("created_at", { ascending: false })
		.limit(UPDATE_LIMIT * 3);
	if (error) return [];
	return (data ?? []) as unknown as ActivityRow[];
}
// #endregion

// #region Mapping
/** Project the visible rooms into the quick-entry list. */
function channelsOf(slug: string, rows: readonly ChannelRow[]): ProjectOverviewChannel[] {
	return rows.slice(0, CHANNEL_LIMIT).map((row) => {
		const kind: ChannelKind = !row.stage_id
			? "general"
			: PRIVATE_ROOM.has(row.visibility)
			? "team"
			: "stage";
		return {
			id: row.id,
			name: clampOr(row.name, NAME_MAX, "Channel"),
			kind,
			// No per-viewer watermark exists — see the module docblock.
			unread: false,
			lastMessagePreview: "",
			href: clamp(`/projects/${slug}/${row.id}`, HREF_MAX),
		};
	});
}

/** Project the viewer's open tickets into the "Your work" block. */
function assignmentsOf(
	slug: string,
	rows: readonly TicketRow[],
	stageNames: ReadonlyMap<string, string>,
): ProjectAssignment[] {
	return rows
		.filter((row) => !CLOSED_TICKET.has(row.status))
		.slice(0, ASSIGNMENT_LIMIT)
		.map((row) => ({
			ticketId: row.id,
			title: clampOr(row.title, 200, "Untitled ticket"),
			stageName: row.current_stage_id ? stageNames.get(row.current_stage_id) ?? null : null,
			status: toTicketStatus(row.status) as TicketStatus,
			dueLabel: row.due_date ? dueLabel(row.due_date) : null,
			href: clamp(`/projects/${slug}/board`, HREF_MAX),
		}));
}

/** Project the activity feed into the update rail, dropping every kind with no honest counterpart. */
function activityOf(
	slug: string,
	rows: readonly ActivityRow[],
	parties: ReadonlyMap<string, PartyRow>,
	now: number,
): ProjectUpdate[] {
	const out: ProjectUpdate[] = [];
	for (const row of rows) {
		const decision = typeof row.payload?.decision === "string" ? row.payload.decision : null;
		// A review is two different events depending on its outcome, and only one of them has a
		// counterpart: a returned submission IS `revision_requested`, while an acceptance is not any
		// member of this vocabulary and is dropped rather than reported as something it is not.
		const kind = row.kind === "submission_reviewed"
			? (decision === "revisions_requested" ? "revision_requested" as const : null)
			: ACTIVITY_KIND[row.kind] ?? null;
		if (!kind) continue;

		const actor = partyOf(parties.get(row.actor_user_id));
		out.push({
			id: row.id,
			kind,
			actor,
			text: clamp(activityText(kind, actor.name), UPDATE_TEXT_MAX),
			at: row.created_at,
			atLabel: relativeLabel(row.created_at, now),
			href: clamp(`/projects/${slug}/board`, HREF_MAX),
		});
		if (out.length >= UPDATE_LIMIT) break;
	}
	return out;
}
// #endregion

// #region Public read
/**
 * The freelancer dashboard for one engagement, or `null` when it does not exist or is not visible.
 *
 * `null` covers both, and the two are deliberately indistinguishable: telling a stranger that a
 * project exists but is not theirs is itself a disclosure.
 */
export async function fetchProjectOverview(
	actor: ReadActor & { accessToken: string },
	projectId: string,
	now: number = Date.now(),
): Promise<ProjectOverview | null> {
	const project = await fetchProject(actor, projectId);
	if (!project) return null;

	const [stages, channels, tickets, activity, owner] = await Promise.all([
		fetchStages(actor, project.id),
		fetchChannels(actor, project.id),
		fetchAssignments(actor, project.id),
		fetchActivity(actor, project.id),
		fetchParties(actor, [project.owner_user_id]),
	]);

	const actorIds = activity.map((row) => row.actor_user_id);
	const parties = actorIds.length > 0 ? await fetchParties(actor, actorIds) : owner;
	const ownerParty = partyOf(owner.get(project.owner_user_id));
	const currency = project.currency?.trim() || "USD";

	const totalStages = stages.length;
	const completedStages = stages.filter((s) => DELIVERED_STAGE_STATUS.has(s.status)).length;
	const stageNames = new Map(stages.map((s) => [s.id, clampOr(s.name, NAME_MAX, "Stage")]));

	// `meta` is pre-formatted server-side for the same reason the feed pre-formats `budgetLabel`: a
	// string assembled in the browser is a different string from the one SSR sent, and the two
	// disagreeing is a hydration mismatch on the first line of the page.
	// Built ONCE and both counted and rendered, rather than counted from the raw fetch and rendered
	// from a filtered projection. The raw rows include closed tickets and are read past the display
	// limit, so the hero was announcing "3 assigned to you" above a list of one.
	const assignments = assignmentsOf(project.slug, tickets, stageNames);

	const meta: string[] = [];
	if (totalStages > 0) meta.push(`${totalStages} ${totalStages === 1 ? "stage" : "stages"}`);
	if (assignments.length > 0) meta.push(`${assignments.length} assigned to you`);

	return {
		// The canonical identity, carried beside the readable alias for the same reason the owner's
		// projection carries it: the uuid is the address, and the slug moves when the title does.
		id: project.id,
		slug: project.slug,
		hero: {
			title: clampOr(project.title, TITLE_MAX, "Untitled project"),
			owner: ownerParty,
			handle: ownerParty.handle,
			status: toProjectStatus(project.status),
			statusLabel: STATUS_LABEL[project.status] ?? "Active",
			meta,
			completedStages: totalStages > 0 ? completedStages : null,
			totalStages: totalStages > 0 ? totalStages : null,
		},
		updates: activityOf(project.slug, activity, parties, now),
		channels: channelsOf(project.slug, channels),
		assignments,
		finance: neutralFinance(currency),
	};
}
// #endregion
