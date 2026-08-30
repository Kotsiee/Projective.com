import type { SupabaseClient } from "supabaseClient";
import type { ReadActor } from "../read-actor.ts";
import {
	type BoardCard,
	type BoardKind,
	type BoardListParams,
	type BoardPage,
	type BoardStageRef,
	type BoardView,
	buildBoardColumns,
	cardColumnId,
	formatTicketMoney,
	type ProjectParty,
	type StageAssignmentMode,
	stageCostCents,
	TICKET_COLUMN_LABEL,
	ticketColumnStatus,
	type TicketHistoryEntry,
	type TicketHistoryKind,
	type TicketPriority,
	type TicketStageRef,
	type TicketStatus,
	type TicketTask,
	ticketTotalCents,
} from "@projective/types/projects";
import {
	clamp,
	clampOr,
	fetchParties,
	NO_UNREAD_SIGNAL,
	partyOf,
	type PartyRow,
	projectsDb,
	toMemberRole,
	toStageProjectStatus,
	toTicketStatus,
} from "./live-support.ts";
import { fetchProjectBySlug } from "./live-queries.ts";

/**
 * live-board — the RLS-scoped Postgres read path for `ProjectBackendService.board`.
 *
 * ## What this module answers
 *
 * One {@link BoardPage}. The project pipeline board (`/projects/[projectId]/board`) and the
 * stage-level Tasks board (`/projects/[projectId]/[channelId]/tasks`) are the same projection
 * discriminated by `channelId`, exactly as the fixtures' `findBoardPage` builds it. The column
 * STRUCTURE and the card-to-column PLACEMENT are not decided here at all: {@link buildBoardColumns}
 * and {@link cardColumnId} are the Zod SSOT's own functions, shared with the feature's instant
 * Stages/Status toggle, and a second implementation of either is how a server's first paint and a
 * client's first toggle come to draw different boards.
 *
 * ## Which SSOT helpers are reused, and the two that cannot be
 *
 * Reused verbatim: `buildBoardColumns`, `cardColumnId`, `stageCostCents`, `ticketTotalCents`,
 * `ticketColumnStatus`, `formatTicketMoney`, `TICKET_COLUMN_LABEL`.
 *
 * NOT reused, with reasons rather than silence:
 *  - **`reconcileCard` is not in the SSOT.** It lives in
 *    `apps/web/features/projects/core/ticket-model.ts`, and root CLAUDE.md §2 forbids this package
 *    from reaching into `@features`. Every figure it derives is derived here from the SAME SSOT
 *    primitives it itself calls (`stageCostCents` then `ticketTotalCents` then
 *    `formatTicketMoney`), and {@link dueLabelOf} reproduces its `formatDueDate` output exactly, so
 *    a client-side reconcile is a no-op on every field but one — see
 *    {@link NEUTRAL_CATEGORY_WEIGHT} for the one that is not, and why.
 *  - **`ticketSpentCents`** is a pure function over {@link BoardCard.payments}, and payments are
 *    always `[]` here (the `finance` schema grants `authenticated` no USAGE — see
 *    {@link NO_PAYMENT_TRAIL}). Calling it would produce a confident `0`, which reads as "nothing
 *    has been spent" rather than "we cannot see the ledger". The client calls it on the array it is
 *    handed, which is the honest place for it.
 *
 * ## Facts about this database the code depends on
 *
 *  - **The schema profile is mandatory.** Every query goes through {@link projectsDb}; without the
 *    profile PostgREST 404s on the table name rather than failing in a way that says why.
 *  - **`marketplace` is not exposed**, so nothing here resolves a blueprint. It does not need to:
 *    `fetchProjectBySlug` already derives the engagement's kind from that FK's mere presence.
 *  - **No cross-schema embedding.** Display parties come from `org.users_public` through
 *    {@link fetchParties}, a second keyed query, never an embed.
 *  - **`projects.ticket_history` has RLS DISABLED and no policy**, while `00002500` grants
 *    `authenticated` ALL on every table in the schema. Any signed-in user can therefore read — and
 *    write — the entire platform's ticket audit log. This read is safe only because it is keyed on
 *    ticket ids that `projects.tickets`' own policy already vetted. **Never widen that key list**,
 *    and never key this query on a project id the tickets read did not first confirm.
 *
 * ## What has no column, and is therefore returned neutral
 *
 * Several fields on this projection have no storage anywhere in the exposed schemas. None is
 * synthesised from something adjacent, because a plausible number is worse than an absent one on a
 * surface whose whole job is to price work: {@link NEUTRAL_CATEGORY_WEIGHT},
 * {@link NEUTRAL_INTENSITY}, {@link NO_PAYMENT_TRAIL}, {@link NO_TICKET_ATTACHMENTS},
 * {@link NO_SUBMISSION_TREE}, {@link NO_ACTIVITY_SIGNAL} and {@link NO_COMMENT_COUNT} each carry
 * their evidence at the point of use.
 */

// #region Caps

/**
 * A hard ceiling on the tickets pulled for one board.
 *
 * {@link BoardListParams} has no cursor and no limit, and {@link BoardPage} has no `hasMore`, so
 * without a bound here a busy pipeline serialises every ticket — each with its stage refs, task
 * list and audit log — into one unpaged response. The number is stated rather than left to
 * PostgREST's `max_rows = 1000` for two reasons: the ticket ids become an `in.(...)` list on the
 * history query's URL (150 uuids is roughly 5.5 KB, comfortably inside the 8 KB request line most
 * proxies allow), and a reader should be able to see the cap without opening a config file three
 * directories away.
 *
 * The truncation is silent by necessity — the projection has nowhere to report it. That is the
 * paging gap, not a defect in this function.
 */
const TICKET_ROW_CAP = 150;

/**
 * A ceiling on audit rows pulled for the whole page, newest first.
 *
 * PostgREST's own `max_rows = 1000` caps this read whatever is asked for, so a per-ticket log is
 * BEST EFFORT by construction: on a board where a handful of tickets have long histories, a quiet
 * ticket can come back with an empty log because the page-wide budget was spent elsewhere. A
 * complete audit log wants its own keyed read against one ticket; the board wants only enough to
 * draw a contributor cascade.
 */
const HISTORY_ROW_CAP = 900;

/** Newest-first audit entries kept per ticket after grouping. Bounds one card's payload. */
const HISTORY_PER_TICKET = 24;

// #endregion

// #region Neutral values (fields with no column)

/**
 * The CREATE-category baseline weight every stage is reported at.
 *
 * **There is no column for this anywhere.** `projects.project_stages` carries a rate
 * (`unit_price_cents`), a cap (`max_concurrent_intensity`) and a routing mode, and nothing that
 * says what KIND of work the stage is. The weight is one of the two factors in
 * `W_i = CategoryWeight x DifficultyMultiplier` (PRODUCT_SPEC §The Weighting Engine), so a guessed
 * value does not render as a gap — it renders as a capacity figure that looks right and is wrong,
 * measured against caps that then refuse real work.
 *
 * `1` is the identity: it leaves `W_i` equal to the multiplier and asserts nothing. **The live path
 * must read the real CREATE-category weight before this number is trusted for anything.**
 *
 * One consequence worth stating, because it is invisible from either side alone: the client's
 * `reconcileCard` recomputes `workload` as `sum(workloadIntensity(categoryWeight ?? 1, intensity))`,
 * which with this neutral weight is simply the stage count. This module instead reports
 * {@link BoardCard.workload} from `projects.tickets.workload_intensity`, the figure the capacity
 * caps are actually summed against. The two will disagree until the weight has a column. Reporting
 * the stored figure is still right — it is the authoritative one — but a reconcile on the client
 * will overwrite it with a fiction. Already flagged by root CLAUDE.md §8 Decision #64(b); recorded
 * again here because this is where the number enters the product.
 */
const NEUTRAL_CATEGORY_WEIGHT = 1;

/**
 * The difficulty multiplier every ticket and every stage ref is reported at.
 *
 * The enum is not stored. `projects.tickets` has `workload_intensity numeric(4,2)`, which is the
 * RESULT of the multiplier rather than the multiplier — `projects.fn_check_workload_capacity` sums
 * that column directly — and with {@link NEUTRAL_CATEGORY_WEIGHT} unknown the two factors cannot be
 * separated back out of their product.
 *
 * `standard` is the only safe reading, and not merely because it is the schema default: it is the
 * IDENTITY multiplier (x1), and both effects of the client's original choice are already baked into
 * what is stored. `projects.tickets.unit_price_cents` is the AGREED per-ticket price — which is why
 * `projects.fn_ticket_cost_breakdown` prices a required stage as
 * `COALESCE(ticket.unit_price_cents, stage.unit_price_cents)` with no multiplier applied — and
 * `workload_intensity` is the agreed capacity. Reporting `high` here would scale an already-scaled
 * figure a second time and quote the client double.
 *
 * The visible cost is that a High ticket's badge reads "Standard". A wrong word beside a right
 * number is recoverable; a right word beside a doubled price is not.
 */
const NEUTRAL_INTENSITY = "standard" as const;

/**
 * Why {@link BoardCard.payments} is always empty.
 *
 * `TicketPaymentEntry` is a projection over `finance.escrows` / `finance.transactions`, and
 * `00002500_permissions_schema_grants.sql` REVOKEs `USAGE ON SCHEMA finance` from `authenticated`
 * without ever re-granting it (root CLAUDE.md §8 Decision #68(a)). `finance` is also absent from
 * `config.toml`'s exposed-schema list, so PostgREST could not reach it even if the grant existed.
 * There is no partial answer available: an empty array is the whole of what this read can say.
 *
 * The Finances tab therefore shows the derived cost breakdown, which comes from the stage rates on
 * the card and is genuine, and no movement history. Nothing is invented to fill the gap: a
 * fabricated "Escrow held" row on a surface about money is the single worst thing this module
 * could emit.
 */
const NO_PAYMENT_TRAIL: BoardCard["payments"] = [];

/**
 * Why {@link BoardCard.attachments} is always empty while `attachmentCount` is real.
 *
 * `projects.tickets.attachment_count` is a smallint counter on the ticket, and there is **no
 * ticket-to-file join table at all**: `projects.project_attachments` is keyed on the PROJECT and
 * `projects.submission_files` on a submission. So the count exists and the rows do not, and a card
 * can honestly say "3 attachments" while listing none.
 *
 * The count is reported because it is stored and true. Materialising three placeholder file items
 * to match it would put three cards in the Attachments tab that open nothing.
 */
const NO_TICKET_ATTACHMENTS: BoardCard["attachments"] = [];

/**
 * Why {@link BoardCard.submissions} and `submissionFiles` are always empty.
 *
 * The deliverable hierarchy is a real read — `projects.stage_submissions` (which does carry
 * `ticket_id`) joined through `projects.submission_files` to `files.items` — and it is the
 * Submissions explorer's own projection, built by its own endpoint from those same rows. Deriving
 * the stage/submitter/unit tree a second time here would be a second implementation of a hierarchy
 * rule, which is the drift this whole read layer is arranged to avoid.
 *
 * Empty is the schema's own default and reads as "nothing has been submitted", which is wrong only
 * for a ticket that has been. The alternative — half a tree, built from a different set of rules,
 * whose segment paths then fail to address the explorer's own nodes — is wrong for every ticket.
 */
const NO_SUBMISSION_TREE: {
	tree: BoardCard["submissions"];
	files: BoardCard["submissionFiles"];
} = { tree: [], files: [] };

/**
 * The activity signal every card gets.
 *
 * `StageActivity` is `new_ticket | revision_requested | stage_invite`, and all three are per-viewer
 * "since you last looked" signals rather than stored states. `revision_requested` has the closest
 * thing to a source (`projects.stage_revision_requests`), but that table records a request against
 * a stage and a ticket with no notion of whether THIS viewer has seen it — so surfacing it would
 * put a permanent icon on a card that never clears. `new_ticket` would have to be derived from
 * `created_at` against a read watermark that does not exist (see {@link NO_UNREAD_SIGNAL}).
 *
 * The field is `.nullable().optional()`, so `null` is a value the schema anticipates: an absent
 * signal reads as "nothing needs you", which is quietly wrong, where an invented one is wrong in
 * the direction people act on.
 */
const NO_ACTIVITY_SIGNAL = null;

/**
 * The comment count every card gets.
 *
 * There is no comment column on `projects.tickets` and no ticket-comment table. Ticket discussion
 * happens in the stage channel (`comms.project_messages`), which is not per-ticket addressable, so
 * there is nothing to count. `0` is the schema's floor and the true count of a thing that does not
 * exist; the alternative would be counting channel messages and labelling them as this ticket's.
 */
const NO_COMMENT_COUNT = 0;

// #endregion

// #region Selected columns

/** The `projects.project_stages` columns a {@link BoardStageRef} needs. */
const STAGE_COLUMNS = [
	"id",
	"project_id",
	"name",
	"description_text",
	"sort_order",
	"status",
	"unit_price_cents",
	"assignment_mode",
	"max_concurrent_intensity",
].join(", ");

/** The `projects.tickets` columns one {@link BoardCard} needs. */
const TICKET_COLUMNS = [
	"id",
	"project_id",
	"current_stage_id",
	"current_assignee_id",
	"owner_user_id",
	"title",
	"text_description",
	"status",
	"priority",
	"attachment_count",
	"required_stages",
	"tasks",
	"due_date",
	"workload_intensity",
	"payment_status",
	"unit_price_cents",
	"sort_order",
	"claimed_at",
	"hidden_until",
	"updated_at",
].join(", ");

/** The `projects.ticket_history` columns one {@link TicketHistoryEntry} needs. */
const HISTORY_COLUMNS = [
	"id",
	"ticket_id",
	"actor_id",
	"action_type",
	"previous_stage_id",
	"new_stage_id",
	"previous_status",
	"new_status",
	"changes",
	"created_at",
].join(", ");

// #endregion

// #region Row shapes

/** One `projects.project_stages` row as selected by {@link STAGE_COLUMNS}. */
interface StageRow {
	id: string;
	project_id: string;
	name: string | null;
	description_text: string | null;
	sort_order: number | null;
	status: string | null;
	unit_price_cents: number | string | null;
	assignment_mode: string | null;
	max_concurrent_intensity: number | string | null;
}

/** One `projects.tickets` row as selected by {@link TICKET_COLUMNS}. */
interface TicketRow {
	id: string;
	project_id: string;
	current_stage_id: string | null;
	current_assignee_id: string | null;
	owner_user_id: string | null;
	title: string | null;
	text_description: string | null;
	status: string | null;
	priority: string | null;
	attachment_count: number | string | null;
	required_stages: unknown;
	tasks: unknown;
	due_date: string | null;
	workload_intensity: number | string | null;
	payment_status: string | null;
	unit_price_cents: number | string | null;
	sort_order: number | null;
	claimed_at: string | null;
	hidden_until: string | null;
	updated_at: string;
}

/** One `projects.ticket_history` row as selected by {@link HISTORY_COLUMNS}. */
interface HistoryRow {
	id: string;
	ticket_id: string;
	actor_id: string | null;
	action_type: string | null;
	previous_stage_id: string | null;
	new_stage_id: string | null;
	previous_status: string | null;
	new_status: string | null;
	changes: unknown;
	created_at: string;
}

/** One `projects.project_participants` row, for the assignee pool and the client-side seats. */
interface ParticipantRow {
	profile_type: string;
	profile_id: string;
	role: string | null;
}

/** One `projects.stage_assignments` row, for a stage's roster. */
interface AssignmentRow {
	project_stage_id: string;
	assignee_type: string;
	freelancer_profile_id: string | null;
	status: string | null;
}

// #endregion

// #region Scalars

/**
 * Coerce a PostgREST scalar to a finite number, or `null`.
 *
 * PostgREST renders `numeric` and `bigint` as JSON number literals, but a driver or a future
 * serialisation setting can hand either back as a string. Written as one function because the
 * obvious inline alternative, `Number(row.unit_price_cents)`, turns a NULL price into `0` — and a
 * stage that has not been priced and a stage that is free are exactly the two facts the money
 * surface is built on keeping apart.
 */
function num(value: number | string | null | undefined): number | null {
	if (value === null || value === undefined) return null;
	const n = typeof value === "number" ? value : Number(value);
	return Number.isFinite(n) ? n : null;
}

/** A non-negative integer for an `int().min(0)` field, or `null` when there is no value. */
function intAtLeastZero(value: number | string | null | undefined): number | null {
	const n = num(value);
	if (n === null) return null;
	return Math.max(0, Math.round(n));
}

/**
 * A stage's Project Hard Cap on summed `W_i`, or `null` for unlimited.
 *
 * `max_concurrent_intensity` is `numeric(6,2)` with no CHECK, while the Zod field is `min(0)`. A
 * negative cap is not a cap, so it degrades to `null` — "unlimited" — rather than to `0`, which
 * would read as "this stage accepts no work at all" and hide a whole roster's capacity behind a
 * data error.
 */
function toCapacityCap(value: number | string | null | undefined): number | null {
	const cap = num(value);
	return cap === null || cap < 0 ? null : cap;
}

// #endregion

// #region Time labels (UTC only)

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * `Jul 14 · 2:30 PM` — the fixtures' `fmtDateTime`, reproduced.
 *
 * Built from `getUTC*` components rather than `Intl`, deliberately. The server renders this label
 * into the first byte and the island re-renders the same card after its refetch; if the label were
 * formatted in the process's local zone, a server in Europe and a browser in California would
 * disagree about which day a ticket was touched, and the disagreement would surface as a flicker on
 * hydration rather than as an error anywhere a test could see it.
 *
 * Returns `""` for an unparseable timestamp. Every consumer of this string is a `.max()` field with
 * no minimum, so an empty label degrades to a missing caption rather than a thrown page.
 */
function fmtDateTime(iso: string | null | undefined): string {
	const ms = iso ? Date.parse(iso) : NaN;
	if (Number.isNaN(ms)) return "";
	const d = new Date(ms);
	let h = d.getUTCHours();
	const m = d.getUTCMinutes();
	const ampm = h < 12 ? "AM" : "PM";
	h = h % 12 || 12;
	return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} · ${h}:${
		m.toString().padStart(2, "0")
	} ${ampm}`;
}

/**
 * `Aug 4` / `Aug 4, 2027` — a due date at the resolution a human reads it at.
 *
 * Reproduces `ticket-model.formatDueDate` exactly, including its rule of printing the year only
 * when it is not the current one, so that a client-side `reconcileCard` recomputes the same string
 * rather than swapping the label out from under the reader. It does not call that function: it is
 * app-side (root CLAUDE.md §2), and it goes through `toLocaleDateString`, which this layer may not
 * use — the label must not depend on the server's locale or zone.
 */
function dueLabelOf(iso: string | null, nowMs: number): string | null {
	if (!iso) return null;
	const ms = Date.parse(iso);
	if (Number.isNaN(ms)) return null;
	const d = new Date(ms);
	const label = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
	return d.getUTCFullYear() === new Date(nowMs).getUTCFullYear()
		? label
		: `${label}, ${d.getUTCFullYear()}`;
}

// #endregion

// #region Parties

/**
 * A {@link ProjectParty} from a public-profile row, clamped to that schema's own bounds.
 *
 * {@link partyOf} composes the name and hands back the username as the handle; it does not clamp,
 * because it serves projections with different bounds. `ProjectPartySchema` caps `name` at 120 and
 * `handle` at 40, while `org.users_public.username` is unbounded `text` carrying only a UNIQUE
 * constraint — so one long username would throw a parse error for an entire board rather than
 * shortening one label.
 */
function boardParty(row: PartyRow | undefined | null): ProjectParty {
	const base = partyOf(row);
	return {
		name: clampOr(base.name, 120, "Unknown"),
		avatar: null,
		handle: base.handle ? clamp(base.handle, 40) : null,
	};
}

/** A party for a user id, or `null` when there is no id. A missing ROW still yields "Unknown". */
function partyFor(
	userId: string | null | undefined,
	parties: Map<string, PartyRow>,
): ProjectParty | null {
	if (!userId) return null;
	return boardParty(parties.get(userId));
}

/** The de-duplication key for a party list. Mirrors the fixtures' `handle ?? name`. */
function partyKey(party: ProjectParty): string {
	return party.handle ?? party.name;
}

/** Append parties not already present, preserving first-seen order. Mutates and returns `into`. */
function mergeParties(into: ProjectParty[], extra: readonly ProjectParty[]): ProjectParty[] {
	const seen = new Set(into.map(partyKey));
	for (const party of extra) {
		const key = partyKey(party);
		if (seen.has(key)) continue;
		seen.add(key);
		into.push(party);
	}
	return into;
}

// #endregion

// #region Stage mapping

/**
 * `projects.project_stages.assignment_mode` onto the Zod {@link StageAssignmentMode}.
 *
 * `projects.assignment_routing_mode` and the Zod enum agree member for member today, so this is a
 * guard against a future member reaching a client as an unparseable row rather than a translation.
 * `open_pull` is the column's own default and the safe landing place: it is the least restrictive
 * routing, so a stage whose mode we cannot read does not appear to be locked down.
 */
function toAssignmentMode(raw: string | null | undefined): StageAssignmentMode {
	switch (raw) {
		case "round_robin":
		case "manual":
		case "parallel_stream":
			return raw;
		default:
			return "open_pull";
	}
}

/**
 * Whether a stage column may be dragged to reorder.
 *
 * This mirrors `projects.fn_stage_reorder_lock`, the BEFORE UPDATE trigger that will actually
 * refuse the write, rather than the fixtures' looser `status !== "draft"`. The trigger raises when
 * ANY of three things holds:
 *
 *  1. the stage's own `stage_status` is past `open`/`assigned`;
 *  2. a ticket currently routed through the stage has any status other than `backlog`;
 *  3. the stage has any `projects.stage_assignments` row at all.
 *
 * Getting this wrong in the permissive direction offers a drag that the database then refuses,
 * which §D.7.7 treats as a defect of the same class as a broken link. Getting it wrong in the
 * restrictive direction only withholds a control the client could have used, which is recoverable.
 * So every input that is missing resolves toward LOCKED.
 *
 * One residual, stated because it cannot be closed from here: condition (2) is evaluated against
 * the tickets this read actually fetched, and that set is capped at {@link TICKET_ROW_CAP}. On a
 * board large enough to truncate, a non-backlog ticket beyond the cap is invisible and the column
 * can read as unlocked. In practice such a stage almost always trips (1) or (3) as well — a ticket
 * gets claimed by somebody who was assigned — and the trigger is still the real gate, so the worst
 * outcome is a refused drag rather than a corrupted stage order.
 */
function stageLocked(
	stage: StageRow,
	ticketsInStage: readonly TicketRow[],
	assignmentCount: number,
): boolean {
	if (stage.status !== "open" && stage.status !== "assigned") return true;
	if (assignmentCount > 0) return true;
	return ticketsInStage.some((t) => t.status !== "backlog");
}

/** Options for {@link toStageRef} — the per-stage facts that come from other queries. */
interface StageContext {
	/** Every ticket fetched for the engagement, so a stage's live load counts all of them. */
	tickets: readonly TicketRow[];
	/** Stage rosters keyed by stage id, from `projects.stage_assignments`. */
	rosters: Map<string, ProjectParty[]>;
	/** Raw assignment-row counts per stage, for the reorder lock's third condition. */
	assignmentCounts: Map<string, number>;
}

/**
 * One `projects.project_stages` row onto the composer's {@link BoardStageRef}.
 *
 * `ticketCount` deliberately counts EVERY fetched ticket routed through the stage, not the filtered
 * card list: it is the inspector's live-load figure, and a load that changed when the client typed
 * into the search box would be describing the search rather than the stage.
 */
function toStageRef(stage: StageRow, ctx: StageContext): BoardStageRef {
	const inStage = ctx.tickets.filter((t) => t.current_stage_id === stage.id);
	return {
		id: clamp(stage.id, 80),
		name: clampOr(stage.name, 120, "Untitled stage"),
		order: Math.max(0, intAtLeastZero(stage.sort_order) ?? 0),
		status: toStageProjectStatus(stage.status),
		locked: stageLocked(stage, inStage, ctx.assignmentCounts.get(stage.id) ?? 0),
		description: clamp(stage.description_text, 2000),
		unitPriceCents: intAtLeastZero(stage.unit_price_cents),
		categoryWeight: NEUTRAL_CATEGORY_WEIGHT,
		members: (ctx.rosters.get(stage.id) ?? []).slice(0, 50),
		ticketCount: inStage.length,
		assignmentMode: toAssignmentMode(stage.assignment_mode),
		maxConcurrentIntensity: toCapacityCap(stage.max_concurrent_intensity),
	};
}

// #endregion

// #region Ticket contents

/**
 * `projects.tickets.tasks` (jsonb) onto the ticket's {@link TicketTask} list.
 *
 * The documented element shape is `{"id", "text", "done", "completed_by": ["user_id", ...]}`. Two
 * spellings of the last key are accepted because the column is unconstrained jsonb written from
 * more than one place, and a checklist that silently loses its attributions is harder to notice
 * than one that never had them.
 *
 * `completedBy` resolves the recorded user ids to parties. A step marked done whose completer is
 * unresolvable keeps the tick and shows an "Unknown" face rather than losing the completion: the
 * done-ness is the ticket's own record, while the face is a lookup that RLS may legitimately
 * withhold.
 */
function toTasks(raw: unknown, parties: Map<string, PartyRow>, prefix: string): TicketTask[] {
	if (!Array.isArray(raw)) return [];
	const out: TicketTask[] = [];
	raw.slice(0, 60).forEach((entry, i) => {
		if (typeof entry !== "object" || entry === null) return;
		const row = entry as Record<string, unknown>;
		const text = typeof row.text === "string" ? row.text : "";
		if (!text.trim()) return;
		const rawCompleters = Array.isArray(row.completed_by)
			? row.completed_by
			: Array.isArray(row.completedBy)
			? row.completedBy
			: [];
		const completedBy = rawCompleters
			.filter((id): id is string => typeof id === "string" && id.length > 0)
			.slice(0, 8)
			.map((id) => boardParty(parties.get(id)));
		out.push({
			id: clampOr(typeof row.id === "string" ? row.id : "", 80, `${prefix}-task-${i}`),
			text: clampOr(text, 240, "Untitled step"),
			done: row.done === true,
			completedBy,
		});
	});
	return out;
}

/** Every user id referenced by a ticket's task list, so the party lookup can be batched. */
function taskCompleterIds(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	const ids: string[] = [];
	for (const entry of raw) {
		if (typeof entry !== "object" || entry === null) continue;
		const row = entry as Record<string, unknown>;
		const list = Array.isArray(row.completed_by)
			? row.completed_by
			: Array.isArray(row.completedBy)
			? row.completedBy
			: [];
		for (const id of list) if (typeof id === "string" && id.length > 0) ids.push(id);
	}
	return ids;
}

/**
 * `projects.tickets.required_stages` (jsonb) onto the ticket's {@link TicketStageRef} list.
 *
 * The stored element is `{"stage_id", "order"}` and nothing else — verified against every reader
 * and writer in the migrations (`fn_ticket_cost_breakdown`, `fn_advance_stage`,
 * `fn_stage_delete_cascade`). So four fields on the projection have no storage and take neutral
 * values rather than borrowed ones:
 *
 *  - **`brief`** is `""`. The tempting fill is `project_stages.description_text`, but that is the
 *    STAGE's standing brief, which the composer already shows separately as
 *    {@link BoardStageRef.description}. Copying it in would make every ticket appear to carry a
 *    per-ticket brief that nobody wrote for it, and an edit would then read as a change to the
 *    stage.
 *  - **`intensity`** is {@link NEUTRAL_INTENSITY}, which keeps `costCents` an identity over the
 *    agreed rate. See that constant for the double-charging this avoids.
 *  - **`tasks`** is `[]`. There is no per-ticket-per-stage checklist column:
 *    `project_stages.default_tasks` is the stage TEMPLATE and `tickets.tasks` is the ticket's own
 *    single list; neither is this.
 *  - **`parallel`** is `false`. Nothing records concurrency, so `executionBands` will draw every
 *    stage as its own sequential step. That is the safe reading — describing work as sequential
 *    when it runs together only understates the pace, where the reverse promises a schedule the
 *    pipeline cannot keep.
 *
 * `unitPriceCents` is `COALESCE(ticket.unit_price_cents, stage.unit_price_cents)`, matching
 * `projects.fn_ticket_cost_breakdown` exactly, so the board's total and the database's own cost
 * RPC cannot disagree about what a ticket costs.
 */
function toStageRefs(
	ticket: TicketRow,
	stagesById: Map<string, StageRow>,
): TicketStageRef[] {
	const raw = Array.isArray(ticket.required_stages) ? ticket.required_stages : [];
	const ticketRate = intAtLeastZero(ticket.unit_price_cents);

	const refs: TicketStageRef[] = [];
	raw.forEach((entry, i) => {
		if (typeof entry !== "object" || entry === null) return;
		const row = entry as Record<string, unknown>;
		const stageId = typeof row.stage_id === "string" ? row.stage_id : null;
		if (!stageId) return;
		const stage = stagesById.get(stageId) ?? null;
		const order = intAtLeastZero(
			typeof row.order === "number" || typeof row.order === "string" ? row.order : null,
		) ?? i;
		// The ticket's own agreed rate wins over the stage's list rate, because it is what this
		// ticket was priced at; the stage's is only the default it was priced FROM.
		const unitPriceCents = ticketRate ?? intAtLeastZero(stage?.unit_price_cents);
		refs.push({
			stageId: clamp(stageId, 80),
			// A required stage the viewer cannot read is a real state: `projects.tickets` lets an
			// assignee see their own ticket while `project_stages` needs project access. The name is
			// `min(1)`, so the absence has to be spelled rather than passed through empty.
			name: clampOr(stage?.name, 120, "Unavailable stage"),
			order,
			status: toStageProjectStatus(stage?.status),
			// The column IS the required list, so membership is the requirement.
			required: true,
			brief: "",
			intensity: NEUTRAL_INTENSITY,
			tasks: [],
			parallel: false,
			costCents: stageCostCents(unitPriceCents, NEUTRAL_INTENSITY),
			unitPriceCents,
		});
	});

	// Re-index after sorting so `order` matches the array position, the invariant the composer's
	// `normaliseStages` enforces on the client. A stored order with gaps or duplicates would
	// otherwise survive into a pipeline whose step numbers skip.
	return refs
		.sort((a, b) => a.order - b.order)
		.map((ref, i) => ({ ...ref, order: i }));
}

// #endregion

// #region History

/**
 * `projects.ticket_history.action_type` onto the Zod {@link TicketHistoryKind}.
 *
 * The column is unconstrained free text. The values the migrations actually write are
 * `'stage_moved'` and `'status_changed'` (`projects.move_ticket`), and the table's own comment
 * names `'created'`, `'reassigned'` and `'metadata_updated'` as the intended vocabulary. Both
 * spellings of each concept are accepted, since the writer set is not closed.
 *
 * An unknown action falls to `edited`, the only member that claims nothing specific: `created`
 * would assert this was the first event, and `status` would assert a lane change the reader could
 * then look for and not find.
 */
function toHistoryKind(raw: string | null | undefined): TicketHistoryKind {
	switch (raw) {
		case "created":
		case "create":
			return "created";
		case "status_changed":
		case "status":
			return "status";
		case "stage_moved":
		case "stage":
			return "stage";
		case "reassigned":
		case "assigned":
		case "claimed":
			return "assigned";
		case "attachment":
		case "attachment_added":
			return "attachment";
		case "submission":
		case "submitted":
			return "submission";
		case "intensity":
		case "workload_intensity":
			return "intensity";
		case "priority":
			return "priority";
		case "due":
		case "due_date":
			return "due";
		default:
			return "edited";
	}
}

/**
 * The display word for a ticket status inside an audit summary.
 *
 * Delegates to the SSOT's own {@link ticketColumnStatus} + {@link TICKET_COLUMN_LABEL} for the five
 * lane statuses, so the log says "Review" wherever the board's column header says "Review". The two
 * overlay states are named separately because folding them through `ticketColumnStatus` would map
 * both to the backlog lane and print "moved it to New" for a cancellation.
 */
function statusWord(raw: string | null | undefined): string | null {
	if (!raw) return null;
	if (raw === "cancelled") return "Cancelled";
	if (raw === "reported_hidden") return "Frozen";
	const status = toTicketStatus(raw) as TicketStatus;
	return TICKET_COLUMN_LABEL[ticketColumnStatus(status)];
}

/**
 * A one-line summary in the fixtures' voice — the verb phrase only, because the surface renders it
 * as `{actor} {summary}` and a summary that repeated the name would read "Ivy Chen Ivy Chen moved…".
 *
 * `min(1)`, so every branch ends in a real phrase. The fallback names the action rather than
 * inventing one: "updated the ticket" is true of any write this table records.
 */
function historySummary(
	row: HistoryRow,
	kind: TicketHistoryKind,
	stageName: string | null,
): string {
	switch (kind) {
		case "created":
			return "created this ticket";
		case "assigned":
			return "claimed this ticket";
		case "stage": {
			const to = stageName ?? "another stage";
			return clampOr(`moved it to the ${to} stage`, 200, "moved it to another stage");
		}
		case "status": {
			const word = statusWord(row.new_status);
			return word
				? clampOr(`moved it to ${word}`, 200, "changed the status")
				: "changed the status";
		}
		case "submission":
			return "submitted work for review";
		case "attachment":
			return "attached a file";
		case "intensity":
			return "changed the workload intensity";
		case "priority":
			return "changed the priority";
		case "due":
			return "changed the due date";
		default:
			return "updated the ticket";
	}
}

/**
 * The supporting line under a summary, or `null`.
 *
 * Only an `edited` entry gets one, and only when `changes` actually names fields — for a status or
 * stage move the summary already carries the whole fact, and repeating it underneath is noise
 * dressed as detail. The keys are column names, humanised by replacing underscores; they are not
 * translated to display labels, because inventing a mapping from column to label is how a log comes
 * to name a field the interface does not have.
 */
function historyDetail(row: HistoryRow, kind: TicketHistoryKind): string | null {
	if (kind !== "edited") return null;
	if (typeof row.changes !== "object" || row.changes === null || Array.isArray(row.changes)) {
		return null;
	}
	const keys = Object.keys(row.changes as Record<string, unknown>);
	if (keys.length === 0) return null;
	const named = keys.slice(0, 12).map((key) => key.replace(/_/g, " ")).join(", ");
	return clamp(`Changed: ${named}`, 400) || null;
}

/**
 * One `projects.ticket_history` row onto a {@link TicketHistoryEntry}.
 *
 * `unread` is {@link NO_UNREAD_SIGNAL}. There is no per-viewer read watermark for a ticket's audit
 * log anywhere in the schema — the DM side has `comms.dm_participants.last_read_at` and the project
 * side has nothing — so every entry reads as seen. Deriving it from `created_at` would put an
 * unread marker on every event on every ticket the viewer had not opened today, and a counter in
 * the footer to match.
 *
 * `targetPath` is `[]` for the same reason {@link NO_SUBMISSION_TREE} is empty: a path is only
 * followable if the tree it addresses is present, and it is not. An entry with nowhere to go
 * carrying `[]` is exactly what the schema documents.
 */
function toHistoryEntry(
	row: HistoryRow,
	parties: Map<string, PartyRow>,
	stagesById: Map<string, StageRow>,
): TicketHistoryEntry {
	const kind = toHistoryKind(row.action_type);
	const stageName = row.new_stage_id ? stagesById.get(row.new_stage_id)?.name ?? null : null;
	return {
		id: clampOr(row.id, 80, `${row.ticket_id}-h`),
		kind,
		// `actor_id` is NOT NULL in the schema, so a null actor here means the profile row itself was
		// unreadable rather than that the platform acted. It still resolves to a party ("Unknown")
		// rather than to `null`, which the projection reserves for a genuine system transition.
		actor: partyFor(row.actor_id, parties),
		summary: historySummary(row, kind, stageName),
		detail: historyDetail(row, kind),
		at: row.created_at,
		dateLabel: clamp(fmtDateTime(row.created_at), 28),
		unread: NO_UNREAD_SIGNAL,
		targetPath: [],
	};
}

/**
 * Everyone who has actually touched the ticket, de-duplicated, in the order they first appear.
 *
 * Mirrors the fixtures' `contributorsOf`: the log arrives newest-first, so it is walked backwards
 * to make the cascade read in involvement order. Derived from the audit log rather than from
 * membership on purpose — the header answers "who has been involved", not "who could be".
 *
 * A truncated log (see {@link HISTORY_ROW_CAP}) therefore under-reports contributors rather than
 * inventing them, which is the direction that leaves a face missing instead of a face wrong.
 */
function contributorsOf(history: readonly TicketHistoryEntry[]): ProjectParty[] {
	const out: ProjectParty[] = [];
	for (let i = history.length - 1; i >= 0; i--) {
		const actor = history[i].actor;
		if (actor) mergeParties(out, [actor]);
	}
	return out.slice(0, 24);
}

// #endregion

// #region Card mapping

/**
 * Whether a ticket is inside an open workload-report freeze window.
 *
 * **This is the one genuinely time-dependent value on the board**, and it is derived rather than
 * filtered, for two reasons that only the migrations make visible.
 *
 * First, the freeze is recorded by `hidden_until`, not by a status.
 * `projects.fn_open_workload_report` stamps `hidden_until = now() + window` and clears the
 * assignee; clearing the assignee then cascades through `projects.fn_ticket_claim_before`, which
 * resets the status to `backlog`. Nothing in any migration ever writes `'reported_hidden'`. The
 * stage-table comment states the rendering rule directly — the card shows the striped Frozen
 * overlay in the New column *while `hidden_until` is in the future* — so the timestamp is the
 * signal and the enum member is vestigial. Both are honoured here so that a future writer of the
 * status is not silently ignored.
 *
 * Second, the row SET is time-dependent too, and not because of anything this function does: the
 * `"View tickets"` policy hides a ticket from a non-owner, non-assignee viewer while
 * `status = 'reported_hidden' AND hidden_until > now()`. Two consequences follow. Because nothing
 * writes that status, the policy's hide branch is currently unreachable, so frozen tickets stay
 * visible to everyone who can see the project — which matches the product's intent that the client
 * SEES the frozen card and responds to it inside the window. And the clock in that predicate is
 * Postgres's, while the clock below is this process's, so on a skewed server the overlay can flip a
 * second or two before or after the row set would have changed. One `now` is captured for the whole
 * page ({@link fetchBoardPage}) so that at least every card on one board agrees with every other.
 *
 * No WHERE clause excludes these rows. Dropping a card the product deliberately renders would make
 * the board quietly disagree with the workload report that produced it.
 */
function isFrozen(ticket: TicketRow, nowMs: number): boolean {
	if (ticket.status === "reported_hidden") return true;
	if (!ticket.hidden_until) return false;
	const until = Date.parse(ticket.hidden_until);
	return Number.isFinite(until) && until > nowMs;
}

/**
 * `projects.tickets.priority` onto the Zod {@link TicketPriority}.
 *
 * `projects.ticket_priority` and the Zod enum agree member for member. `normal` is the column's own
 * NOT NULL default and the reading that misleads least: an unreadable priority should not sort a
 * ticket to the top of a triage queue.
 */
function toPriority(raw: string | null | undefined): TicketPriority {
	return raw === "low" || raw === "high" || raw === "urgent" ? raw : "normal";
}

/**
 * Whether escrow is currently held against this ticket.
 *
 * `finance.escrows` is unreachable ({@link NO_PAYMENT_TRAIL}), but `projects.tickets.payment_status`
 * is the projects-schema mirror the escrow functions maintain in the same transaction:
 * `finance.fn_hold_ticket_escrow` stamps `escrow_funded`, and the release path stamps `released`
 * when the ticket completes or `partially_released` when it does not. So `partially_released`
 * counts as held — some of the ticket's money has moved and the rest has not — while `released`,
 * `refunded` and `unpaid` do not.
 *
 * This is a genuine column read, not a guess: it is the same value the board's own move warnings
 * are written against.
 */
function escrowHeldOf(paymentStatus: string | null | undefined): boolean {
	return paymentStatus === "escrow_funded" || paymentStatus === "partially_released";
}

/** Options for {@link toCard} — the per-ticket facts resolved by the secondary reads. */
interface CardContext {
	stagesById: Map<string, StageRow>;
	parties: Map<string, PartyRow>;
	/** Newest-first audit entries keyed by ticket id. */
	history: Map<string, TicketHistoryEntry[]>;
	/** The engagement's currency, for the money label. */
	currency: string;
	/** One clock for the whole page. See {@link isFrozen}. */
	nowMs: number;
}

/**
 * One `projects.tickets` row onto a {@link BoardCard}.
 *
 * Money and capacity are never invented for the card. The price is
 * {@link ticketTotalCents} over the stage refs — the same summation the composer's footer performs,
 * so a card and the modal that opens it cannot quote different totals — and the label goes through
 * the SSOT's own {@link formatTicketMoney} so a client-side recompute produces an identical string.
 *
 * `workload` is read straight from `projects.tickets.workload_intensity`, the figure
 * `projects.fn_check_workload_capacity` sums against a freelancer's caps. It is deliberately NOT
 * recomputed from category weight and multiplier here: both of those are neutral
 * ({@link NEUTRAL_CATEGORY_WEIGHT}, {@link NEUTRAL_INTENSITY}), so a recomputation would return the
 * stage count and overwrite the only authoritative number on the card.
 */
function toCard(ticket: TicketRow, ctx: CardContext): BoardCard {
	const stages = toStageRefs(ticket, ctx.stagesById);
	const budgetCents = ticketTotalCents(stages);
	const description = clamp(ticket.text_description, 4000).trim();
	const history = ctx.history.get(ticket.id) ?? [];
	const tasks = toTasks(ticket.tasks, ctx.parties, ticket.id);
	const assignee = partyFor(ticket.current_assignee_id, ctx.parties);

	return {
		id: clamp(ticket.id, 120),
		title: clampOr(ticket.title, 200, "Untitled ticket"),
		description: description.length > 0 ? description : null,
		/*
		 * The purchasing gate (PRODUCT_SPEC §Creation & Purchasing Gate), read from the flattened
		 * `text_description` alone.
		 *
		 * The database's own gate is WIDER: `projects.fn_enforce_ticket_checkout_desc` lets a
		 * purchase through when `text_description` is non-blank OR the `description` jsonb is
		 * anything but `{}`, and no trigger flattens the second into the first — a writer that
		 * populated only the rich-text document leaves this column empty. So a ticket can be
		 * claimable in Postgres and read as un-briefed here.
		 *
		 * That asymmetry is deliberate in this direction. The client's own `hasContent` recomputes
		 * this flag from the `description` STRING, so reporting `true` beside a `null` description
		 * would simply flip back to `false` on hydration; and being wrong this way withholds a
		 * purchase control the database would have allowed, rather than offering one it will refuse.
		 * The real fix is upstream: the ticket write path should flatten its rich text, as the
		 * column's own comment says it is for.
		 */
		hasDescription: description.length > 0,
		status: toTicketStatus(ticket.status) as TicketStatus,
		stageId: ticket.current_stage_id,
		assignee,
		owner: partyFor(ticket.owner_user_id, ctx.parties),
		contributors: contributorsOf(history),
		// `claimed_at` is stamped by `projects.fn_ticket_claim_before` when an assignee attaches.
		// The assignee is checked too because the freeze path clears `claimed_at`'s companion while
		// a ticket mid-review still has one, and the escrow warning this flag gates must not be
		// skipped on a ticket somebody is demonstrably working.
		claimed: ticket.claimed_at !== null || assignee !== null,
		escrowHeld: escrowHeldOf(ticket.payment_status),
		priority: toPriority(ticket.priority),
		intensity: NEUTRAL_INTENSITY,
		workload: Math.max(0, num(ticket.workload_intensity) ?? 0),
		dueDate: ticket.due_date,
		dueLabel: dueLabelOf(ticket.due_date, ctx.nowMs),
		budgetCents,
		budgetLabel: budgetCents === null
			? null
			: clamp(formatTicketMoney(budgetCents, ctx.currency), 24),
		activity: NO_ACTIVITY_SIGNAL,
		frozen: isFrozen(ticket, ctx.nowMs),
		commentCount: NO_COMMENT_COUNT,
		attachmentCount: intAtLeastZero(ticket.attachment_count) ?? 0,
		checklistDone: tasks.filter((t) => t.done).length,
		checklistTotal: tasks.length,
		stages,
		tasks,
		attachments: NO_TICKET_ATTACHMENTS,
		history,
		submissions: NO_SUBMISSION_TREE.tree,
		submissionFiles: NO_SUBMISSION_TREE.files,
		payments: NO_PAYMENT_TRAIL,
		// Counted from the entries rather than stored separately, so the footer's number and the
		// markers in the History rail cannot disagree. With {@link NO_UNREAD_SIGNAL} this is always
		// zero; deriving it here rather than hard-coding it means it becomes correct for free on the
		// day a read watermark exists.
		unreadCount: history.filter((h) => h.unread).length,
		updatedAt: ticket.updated_at,
		dateLabel: clamp(fmtDateTime(ticket.updated_at), 28),
		// `sort_order` is nullable — it is manual only inside the New column and left unset
		// elsewhere, where the board orders by recency. `0` is the schema's own reading of "unset".
		sortOrder: ticket.sort_order ?? 0,
	};
}

// #endregion

// #region Board shape

/**
 * The board's pre-resolved title. Mirrors the fixtures' `boardTitle` exactly, so a live board and a
 * stubbed one label the same engagement the same way.
 */
function boardTitle(kind: BoardKind, engagement: "service" | "project", format: string): string {
	if (kind === "stage") return "Tasks";
	if (engagement === "service" || format === "session") return "Calendar";
	if (format === "one_off") return "Timeline";
	return "Pipeline";
}

/**
 * Whether the acting viewer is on the CLIENT side of the engagement.
 *
 * Mirrors the rule the detail fixtures apply: on a client-architected project the owner, admin and
 * client seats are the buying side; on a provider-side service only an explicit `client` seat is,
 * because the actor there is usually the provider. The rule is reproduced rather than imported
 * because the fixture module does not export it, and it gates the client-only actions (ticket
 * moves, stage reorder, create) — so the two implementations agreeing matters more than either
 * being clever.
 */
function viewerIsClientOf(
	engagement: "service" | "project",
	viewerRole: string,
): boolean {
	if (engagement === "project") {
		return viewerRole === "owner" || viewerRole === "admin" || viewerRole === "client";
	}
	return viewerRole === "client";
}

/**
 * The stage a channel-scoped board is showing, or `null`.
 *
 * A channel id is resolved against the stage's own id and against the `stage-{id}` column-id
 * convention. It is deliberately NOT resolved against `comms.project_channels`: the channel-to-
 * stage mapping belongs to the channel read, and duplicating it here would put a second answer to
 * "which stage is this channel" into the product.
 *
 * An unresolvable channel yields `null`, and the caller then returns an EMPTY card list — matching
 * the fixtures, and preferring an empty board to a board that silently shows every stage's tickets
 * under one stage's name.
 */
function stageForChannel(stages: readonly StageRow[], channelId: string): StageRow | null {
	return stages.find((s) => s.id === channelId || `stage-${s.id}` === channelId) ?? null;
}

/**
 * Whether a card matches the request's filters.
 *
 * Applied in TypeScript rather than in SQL, for two reasons. The stage list's `ticketCount` is a
 * live-load figure that must count every ticket, not the filtered ones, so the unfiltered set has
 * to be materialised anyway. And `query` is free text going into a `LIKE` pattern, where `%`, `_`
 * and the PostgREST reserved characters each need escaping — a filter this cheap is not worth a
 * class of injection-shaped bug.
 */
function matches(card: BoardCard, params: BoardListParams): boolean {
	if (params.query && !card.title.toLowerCase().includes(params.query.toLowerCase())) return false;
	if (params.assignee && card.assignee?.handle !== params.assignee) return false;
	if (params.priority && card.priority !== params.priority) return false;
	return true;
}

// #endregion

// #region Secondary reads

/**
 * The engagement's currency, for the money labels.
 *
 * A second, single-row read of `projects.projects` rather than a widening of
 * {@link fetchProjectBySlug}: `ProjectSummary` does not carry a currency, that projection is
 * another module's contract, and a board that renders a GBP engagement's tickets with a dollar sign
 * is a money error rather than a cosmetic one.
 *
 * Degrades to `"USD"` — the column's own NOT NULL default — rather than throwing. A failed currency
 * lookup should cost a symbol, not a page.
 */
async function fetchCurrency(db: SupabaseClient, projectId: string): Promise<string> {
	const { data, error } = await db
		.from("projects")
		.select("currency")
		.eq("id", projectId)
		.maybeSingle();
	if (error || !data) return "USD";
	const currency = (data as { currency: string | null }).currency;
	return currency && currency.length === 3 ? currency.toUpperCase() : "USD";
}

/**
 * The engagement's stages, in board order.
 *
 * This one THROWS on failure while its siblings below do not. The stages are the board's columns:
 * without them `buildBoardColumns` produces New and Completed alone, and every stage-routed ticket
 * lands in New — a board that renders confidently and is structurally wrong. That is the shape of
 * failure worth surfacing to the caller so it can fall back rather than paint.
 */
async function fetchStages(db: SupabaseClient, projectId: string): Promise<StageRow[]> {
	const { data, error } = await db
		.from("project_stages")
		.select(STAGE_COLUMNS)
		.eq("project_id", projectId)
		.order("sort_order", { ascending: true });
	if (error) throw new Error(`projects.project_stages read failed: ${error.message}`);
	return (data ?? []) as unknown as StageRow[];
}

/**
 * The engagement's tickets, newest-touched first, capped at {@link TICKET_ROW_CAP}.
 *
 * Throws for the same reason {@link fetchStages} does: the tickets ARE the board.
 *
 * Ordered by `updated_at` rather than by `sort_order` because `sort_order` is nullable — it is
 * manual only inside the New column — so ordering by it would sort every stage-routed ticket into
 * one undefined block and then let the cap take an arbitrary slice of it. Recency at least makes
 * the truncation predictable: what falls off the end is what nobody has touched.
 */
async function fetchTickets(db: SupabaseClient, projectId: string): Promise<TicketRow[]> {
	const { data, error } = await db
		.from("tickets")
		.select(TICKET_COLUMNS)
		.eq("project_id", projectId)
		.order("updated_at", { ascending: false })
		.limit(TICKET_ROW_CAP);
	if (error) throw new Error(`projects.tickets read failed: ${error.message}`);
	return (data ?? []) as unknown as TicketRow[];
}

/**
 * Raw audit rows for the given tickets, newest first.
 *
 * A separate keyed query rather than an embed, and deliberately so: `projects.ticket_history`
 * carries TWO foreign keys to `projects.project_stages` (`previous_stage_id`, `new_stage_id`), so
 * any embed of that relation raises `PGRST201` unless the constraint is named — a fragile
 * dependency on constraint names for a join this read does not need.
 *
 * The key list is the ticket ids the RLS-scoped tickets read returned, which is also the ONLY thing
 * keeping this query tenant-scoped: the table has row-level security disabled and no policy while
 * `authenticated` holds a blanket grant on the schema (see the module docblock). Widening this
 * filter to a project id, or to no filter at all, would read other tenants' audit logs.
 *
 * Returns `[]` on failure. The log is supporting material for a card that has already resolved.
 */
async function fetchHistoryRows(
	db: SupabaseClient,
	ticketIds: readonly string[],
): Promise<HistoryRow[]> {
	if (ticketIds.length === 0) return [];
	const { data, error } = await db
		.from("ticket_history")
		.select(HISTORY_COLUMNS)
		.in("ticket_id", ticketIds as string[])
		.order("created_at", { ascending: false })
		.limit(HISTORY_ROW_CAP);
	if (error) return [];
	return (data ?? []) as unknown as HistoryRow[];
}

/**
 * The engagement's participant rows.
 *
 * Selected without a `profile_type` predicate. `profile_type` is the `profile_type` enum, whose
 * members are exactly `('freelancer','business')` — there is no `'user'` — so a filter written
 * against the intuitive spelling raises `22P02` on every request rather than returning nothing, and
 * this lookup swallows its errors by design. The type is read back and discriminated in
 * TypeScript instead, where being wrong costs a row rather than the query.
 *
 * Returns `[]` on failure, and legitimately does so more often than a reader expects:
 * `projects.project_participants` has no participant SELECT policy at all — only owner-or-public —
 * so a hired freelancer viewing a private engagement sees an empty roster. That is a missing policy
 * in the schema rather than something a query can fix; the same gap is recorded in
 * `documentation/architecture/READ_API_FINDINGS.md` for the feed.
 */
async function fetchParticipants(
	db: SupabaseClient,
	projectId: string,
): Promise<ParticipantRow[]> {
	const { data, error } = await db
		.from("project_participants")
		.select("profile_type, profile_id, role")
		.eq("project_id", projectId);
	if (error) return [];
	return (data ?? []) as unknown as ParticipantRow[];
}

/**
 * Stage assignment rows for the given stages.
 *
 * Feeds two things: each stage's roster ({@link BoardStageRef.members}) and the third condition of
 * the reorder lock ({@link stageLocked}). Returns `[]` on failure, which withholds a roster and —
 * because the lock resolves toward locked — withholds a drag rather than offering one the database
 * will refuse.
 */
async function fetchAssignments(
	db: SupabaseClient,
	stageIds: readonly string[],
): Promise<AssignmentRow[]> {
	if (stageIds.length === 0) return [];
	const { data, error } = await db
		.from("stage_assignments")
		.select("project_stage_id, assignee_type, freelancer_profile_id, status")
		.in("project_stage_id", stageIds as string[]);
	if (error) return [];
	return (data ?? []) as unknown as AssignmentRow[];
}

// #endregion

// #region The read

/**
 * The board page for one engagement, or `null` when there is no such project.
 *
 * `null` means "no such row" and is the caller's 404. A thrown {@link Error} — always naming the
 * table — means the query itself failed, which the service catches, logs and falls back to fixtures
 * for. Secondary lookups (parties, history, participants, stage rosters, currency) never throw:
 * each degrades to a neutral value, so one withheld join costs a face or a label rather than the
 * page that had already resolved around it.
 *
 * ## The three waves, and why they are not one
 *
 * The reads run in three dependency-ordered waves rather than in series, because none of the
 * queries inside a wave depends on another's result and awaiting them one at a time would add every
 * latency to every board render:
 *
 *  1. the project (its own resolver, which also settles visibility);
 *  2. currency, stages and tickets, all keyed on the project id;
 *  3. history, participants and stage assignments, keyed on the ids wave 2 returned;
 *  4. parties, which needs every user id the first three waves collected — assignees, ticket
 *     owners, audit actors, checklist completers, participants and stage rosters — resolved in one
 *     `.in()` rather than per row.
 *
 * ## Which clock
 *
 * One `now` is captured at the top and threaded through every derivation ({@link isFrozen},
 * {@link dueLabelOf}). Reading `Date.now()` at each call site would let two cards on the same board
 * straddle a midnight or a freeze expiry and disagree about the same instant.
 */
export async function fetchBoardPage(
	actor: ReadActor & { accessToken: string },
	params: BoardListParams,
): Promise<BoardPage | null> {
	const nowMs = Date.now();

	// Wave 1 — the engagement. Resolved through the feed's own project resolver rather than a local
	// read, so the workspace label, the viewer's role and the engagement kind are computed exactly
	// once in the codebase. It resolves by SLUG, which is what `/projects/[projectId]` carries.
	const summary = await fetchProjectBySlug(actor, params.projectId);
	if (!summary) return null;

	const db = projectsDb(actor);

	// Wave 2 — everything keyed on the project id.
	const [currency, stageRows, ticketRows] = await Promise.all([
		fetchCurrency(db, summary.id),
		fetchStages(db, summary.id),
		fetchTickets(db, summary.id),
	]);

	const stageIds = stageRows.map((s) => s.id);
	const ticketIds = ticketRows.map((t) => t.id);

	// Wave 3 — everything keyed on the ids wave 2 returned.
	const [historyRows, participantRows, assignmentRows] = await Promise.all([
		fetchHistoryRows(db, ticketIds),
		fetchParticipants(db, summary.id),
		fetchAssignments(db, stageIds),
	]);

	// Wave 4 — one party lookup for every person named anywhere on the page.
	//
	// `profile_id` is only a user id when `profile_type` is `'freelancer'`; a `'business'` row
	// carries a business id, which would resolve to no profile and surface as an "Unknown" seat on
	// the assignee filter. Discriminated here in TypeScript rather than in the query, for the enum
	// reason given on {@link fetchParticipants}.
	const personParticipants = participantRows.filter((p) => p.profile_type === "freelancer");
	const parties = await fetchParties(actor, [
		...ticketRows.map((t) => t.current_assignee_id),
		...ticketRows.map((t) => t.owner_user_id),
		...ticketRows.flatMap((t) => taskCompleterIds(t.tasks)),
		...historyRows.map((h) => h.actor_id),
		...personParticipants.map((p) => p.profile_id),
		...assignmentRows.map((a) => a.freelancer_profile_id),
	]);

	// #region Stage list
	const stagesById = new Map(stageRows.map((s) => [s.id, s]));
	const rosters = new Map<string, ProjectParty[]>();
	const assignmentCounts = new Map<string, number>();
	for (const row of assignmentRows) {
		assignmentCounts.set(
			row.project_stage_id,
			(assignmentCounts.get(row.project_stage_id) ?? 0) + 1,
		);
		// A team assignment carries `team_id` and no user, so it contributes to the LOCK (a stage
		// with any assignment cannot be reordered) but not to the roster, which is a list of people.
		if (row.assignee_type !== "freelancer" || !row.freelancer_profile_id) continue;
		// `stage_assignments.status` is unconstrained free text; the values observed across the
		// migrations are assigned / accepted / released / cancelled / declined / completed /
		// pending_funding. Only the two that mean the seat is no longer held are excluded, because a
		// deny-list of the states that end an assignment is safer than an allow-list of the ones
		// that start it: a new state added tomorrow should show a member, not silently hide one.
		if (row.status === "cancelled" || row.status === "declined") continue;
		const roster = rosters.get(row.project_stage_id) ?? [];
		mergeParties(roster, [boardParty(parties.get(row.freelancer_profile_id))]);
		rosters.set(row.project_stage_id, roster);
	}

	const stages: BoardStageRef[] = stageRows.map((stage) =>
		toStageRef(stage, { tickets: ticketRows, rosters, assignmentCounts })
	);
	// #endregion

	// #region Cards
	const historyByTicket = new Map<string, TicketHistoryEntry[]>();
	for (const row of historyRows) {
		const list = historyByTicket.get(row.ticket_id) ?? [];
		// The rows arrive newest-first from the query, so appending preserves that order and the cap
		// keeps the most recent events rather than an arbitrary slice.
		if (list.length < HISTORY_PER_TICKET) list.push(toHistoryEntry(row, parties, stagesById));
		historyByTicket.set(row.ticket_id, list);
	}

	const kind: BoardKind = params.channelId ? "stage" : "project";
	const view: BoardView = params.view ?? "stages";
	const cardContext: CardContext = {
		stagesById,
		parties,
		history: historyByTicket,
		currency,
		nowMs,
	};

	const allCards = ticketRows.map((ticket) => toCard(ticket, cardContext));
	const columns = buildBoardColumns(stages, view, kind);

	/*
	 * A card whose column does not exist would vanish from the board without a trace — it is in
	 * `cards`, it renders in no lane, and nothing anywhere reports it. That is reachable rather than
	 * theoretical: `projects.tickets` lets an assignee read their own ticket via
	 * `current_assignee_id = auth.uid()`, while `projects.project_stages` requires project access,
	 * so a freelancer with no participant row sees the ticket and not the stage it points at.
	 *
	 * The check runs through {@link cardColumnId}, the SAME placement rule the client applies, so it
	 * cannot drift from the thing it is protecting. It is deliberately evaluated against the STAGES
	 * grouping rather than the requested `view`: the Stages/Statuses toggle is instant and
	 * client-side with no refetch, so a card has to be placeable in BOTH groupings, and only the
	 * Stages view turns a `stageId` into a column id. An unplaceable card falls back to the New
	 * column (`stageId: null`), which is where a ticket with no reachable stage belongs.
	 */
	const stageViewColumnIds = new Set(
		buildBoardColumns(stages, "stages", "project").map((c) => c.id),
	);
	const placed = allCards.map((card) =>
		stageViewColumnIds.has(cardColumnId(card, "stages", "project"))
			? card
			: { ...card, stageId: null }
	);

	let cards = placed;
	if (kind === "stage") {
		const stage = stageForChannel(stageRows, params.channelId ?? "");
		cards = stage ? placed.filter((c) => c.stageId === stage.id) : [];
	}
	cards = cards.filter((card) => matches(card, params));
	// #endregion

	// #region Seats
	// The provider side: participants whose mapped role is not a buying seat. `role` is free text
	// whose only written value is `'assignee'`, which {@link toMemberRole} resolves to `freelancer`.
	const clientRoles = new Set(["client", "owner", "admin", "manager"]);
	const assignees: ProjectParty[] = [];
	const clientMembers: ProjectParty[] = [];
	for (const row of personParticipants) {
		const party = boardParty(parties.get(row.profile_id));
		if (clientRoles.has(toMemberRole(row.role))) mergeParties(clientMembers, [party]);
		else mergeParties(assignees, [party]);
	}
	/*
	 * Union in the people actually holding tickets. The participant read is frequently empty for a
	 * non-owner viewer (see {@link fetchParticipants}), and an assignee filter with no options
	 * beside cards that visibly name their assignee is a control that is offered and then refuses.
	 * These are real, visible people rather than an inference — every one of them is named on a card
	 * on this same board.
	 */
	mergeParties(
		assignees,
		allCards.map((c) => c.assignee).filter((p): p is ProjectParty => p !== null),
	);

	/*
	 * Client-side seats exist only where "which of us owns this" is a real question. On a personal
	 * engagement there is nobody to hand a ticket to, which is why the selector is absent there
	 * rather than empty.
	 *
	 * On a shared workspace this list is the participant rows alone. The buying side's full seat
	 * roster lives in `org.team_members` / `org.business_members` / `org.organisation_members` —
	 * the workspace domain's read, behind its own gate — and composing it here would offer a
	 * selector naming people this module cannot confirm are on the engagement at all.
	 */
	const seats = summary.scopeType === "personal" ? [] : clientMembers.slice(0, 60);
	// #endregion

	return {
		scope: params.channelId ? "channel" : "project",
		kind,
		projectId: clamp(params.projectId, 120),
		channelId: params.channelId ? clamp(params.channelId, 120) : null,
		format: summary.format,
		title: boardTitle(kind, summary.kind, summary.format),
		view,
		viewerIsClient: viewerIsClientOf(summary.kind, summary.viewerRole),
		columns,
		cards,
		stages,
		assignees,
		workspaceKind: summary.scopeType,
		workspaceLabel: clampOr(summary.scopeLabel, 120, "Personal"),
		clientMembers: seats,
		viewerId: clamp(actor.userId, 80),
		total: cards.length,
	};
}

// #endregion
