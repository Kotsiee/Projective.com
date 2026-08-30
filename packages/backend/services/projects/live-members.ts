import type { SupabaseClient } from "supabaseClient";
import type { ReadActor } from "../read-actor.ts";
import type {
	ChannelKind,
	MemberInvite,
	MemberRole,
	MemberRosterPage,
	MemberRosterParams,
	MemberStageRef,
	MemberViewerCaps,
	ProjectFormat,
	ProjectMemberRow,
	StageAssignment,
} from "@projective/types/projects";
import {
	clamp,
	clampOr,
	commsDb,
	fetchParties,
	NO_PRESENCE_SIGNAL,
	orgDb,
	partyName,
	partyOf,
	type PartyRow,
	projectsDb,
	toInviteStatus,
	toMemberRole,
} from "./live-support.ts";

/**
 * live-members — the RLS-scoped Postgres read path behind `ProjectBackendService.members`.
 *
 * ## What the roster is, and where it parts company with the fixture it replaces
 *
 * `members-fixtures.ts` DERIVES a roster from a `ProjectDetail`: it invents a supporting cast so every
 * role badge is demonstrable, synthesises presence from an id hash, composes an email out of a handle,
 * and honours the three DEV-ONLY `sim*` hints. None of that survives here, and the schema says so
 * itself — {@link MemberRosterParams} documents the `sim*` fields as hints "the live path ignores"
 * (the real viewer role, engagement format and invitation table are authoritative). So this module
 * reads what is there and returns the neutral value where nothing is:
 *
 *  - **presence** has no column in ANY exposed schema — no `last_seen_at`, no `online` flag — and
 *    `MemberPresence` is required rather than nullable, so every row carries
 *    {@link NO_PRESENCE_SIGNAL}. Its docblock explains why an invented value would be worse.
 *  - **email** is `z.string().max(160)` with no `min(1)`, so its neutral value is the EMPTY STRING,
 *    not null — see {@link fetchViewerEmail} for what is readable and why almost nothing is.
 *  - **stages** are the project's real stage rows in every format. The fixture collapses a one-off to
 *    a single synthetic "Full delivery" milestone and a session to `[]`; those are derivations that
 *    exist because a fixture has no stage table to read. A live session engagement that genuinely
 *    carries stage rows should show them.
 *
 * ## Two tables answer "who is here", and only one of them is about people
 *
 * A roster row is a PERSON. `projects.project_participants.profile_type` is the `profile_type` enum,
 * whose members are exactly `('freelancer','business')` — a `business` row's `profile_id` is a business
 * id, and `projects.stage_assignments` can likewise name a `team_id` instead of a freelancer. Neither
 * has a name in `org.users_public`, an email, a presence or a join date the way a person does;
 * emitting one would produce a row reading "Unknown · offline · —" that looks like a failed lookup
 * rather than an organisation. Entity participants are therefore EXCLUDED and their seats are not
 * enumerated: expanding a business or a team into its members is an `org.*_members` read behind its
 * own gate, not something to infer here.
 *
 * ## The project owner is seeded, not looked up
 *
 * `projects.create_project` writes no participant row for the owner, so a roster built purely from
 * `project_participants` omits the one person with authority over the engagement. The owner is
 * therefore seeded from `projects.projects.owner_user_id`; a participant row for that same user does
 * not displace the `owner` role — see {@link mergeParticipants} for why that ordering matters.
 *
 * ## What RLS will and will not do here — read before trusting a predicate
 *
 * Every query runs under the caller's JWT. Two facts about the policies matter to a reader of this
 * file, because in both cases the code compensates for the schema rather than leaning on it:
 *
 *  1. **`projects.project_participants` has no participant-visibility arm.** Its SELECT policy is
 *     `owner_user_id = auth.uid() OR (status = 'active' AND visibility = 'public')` — the same hole
 *     that `"Participants can view their projects"` closed on `projects.projects` and that was never
 *     closed here. A freelancer hired onto a PRIVATE engagement can read the project row and gets an
 *     EMPTY participant list. That is a missing policy, not something a query can fix; it surfaces as
 *     a roster of one (the seeded owner) rather than as an error.
 *  2. **`projects.project_invitations` has RLS DISABLED and a blanket grant.** It appears in no
 *     `ENABLE ROW LEVEL SECURITY` statement, carries no policy, and `00002500` grants
 *     `ALL ON ALL TABLES IN SCHEMA projects TO authenticated`. Every signed-in user can therefore read
 *     every invitation on the platform — `target_email`, and `token`, which is the bearer capability
 *     that ACCEPTS the invitation. {@link fetchInvitations} never selects `token`, bounds itself with
 *     an explicit `.eq("project_id", …)`, and is called only for a managing viewer, so the application
 *     withholds what the database does not. That is a mitigation on one call path, not a fix: any
 *     other caller of that table has none of it.
 *
 * ## Pre-formatted labels are UTC-derived
 *
 * `joinedLabel` and `invitedLabel` are rendered by the server and re-rendered by the client, so they
 * are composed from `getUTC*` — never `Intl`, never local time — exactly as the fixtures document. The
 * relative label additionally takes ONE clock for the whole response, so two invitations cannot
 * straddle a day boundary mid-render and disagree about what "yesterday" means.
 */

// #region Constants

/**
 * A canonical uuid, used to decide whether an incoming route segment may be compared against a `uuid`
 * column at all.
 *
 * `projects.projects.slug` is CHECKed as `^[a-z0-9-]{1,96}$`, which a uuid also satisfies — so shape
 * alone cannot tell the two apart and a segment must be TESTED rather than assumed. This matters
 * because PostgREST casts the operand: `id.eq.my-project` is not a miss, it is
 * `22P02 invalid input syntax for type uuid`, i.e. a thrown page read on an ordinary 404.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `projects.projects` columns the roster envelope needs. */
const PROJECT_COLUMNS = "id, slug, title, format, owner_user_id, created_at";

/** The `projects.project_participants` columns one roster row needs. */
const PARTICIPANT_COLUMNS = "id, profile_type, profile_id, role, created_at";

/**
 * The `projects.project_invitations` columns the pending queue needs.
 *
 * `token` is absent by construction rather than by omission: it is the bearer capability that accepts
 * the invitation, no projection needs it, and the table has no RLS to stop it leaving (module
 * docblock, point 2). A column not selected is a column that cannot be serialised by accident.
 */
const INVITATION_COLUMNS =
	"id, project_stage_id, target_email, role, inviter_user_id, status, created_at, expires_at";

/**
 * The `projects.stage_assignments.status` values that mean the seat is HELD.
 *
 * The column is free text with no CHECK and no default, so this list is observational rather than
 * derived: the values the migrations and RPCs actually write are `assigned` · `accepted` · `released`
 * · `cancelled` · `declined` · `completed` · `pending_funding`. **There is no `'active'`** — matching
 * that spelling returns nothing at all, which is the failure mode that renders a fully staffed
 * pipeline as one where nobody is assigned, with no error anywhere to say why.
 *
 * `completed` is included because `assignedStages` is documented as the stages a participant
 * "contributes to", and finishing a stage does not retract having worked it. `pending_funding` is
 * included because the seat IS theirs — Decision #80 parks a blueprint-instantiated assignment there
 * before the client funds it, and a person holding an unfunded seat is still the person assigned to
 * it. The three exclusions are precisely the ways a seat is given up.
 */
const HELD_ASSIGNMENT_STATUS: readonly string[] = [
	"assigned",
	"accepted",
	"completed",
	"pending_funding",
];

/**
 * The `ticket_status` members that count toward a participant's open workload.
 *
 * Everything except the three terminal-or-withheld states: `completed` and `cancelled` are finished,
 * and `reported_hidden` is hidden from the board while a report is triaged — counting it would put a
 * number on the roster for work the viewer cannot open.
 */
const OPEN_TICKET_STATUS: readonly string[] = [
	"backlog",
	"todo",
	"claimed",
	"in_progress",
	"in_review",
];

/** The roles that oversee an engagement rather than deliver on it. Drives caps AND visibility. */
const LEADERSHIP_ROLES: ReadonlySet<MemberRole> = new Set<MemberRole>([
	"client",
	"owner",
	"admin",
	"manager",
]);

/** Display order for the roster: authority first, then delivery, then read-limited observers. */
const ROLE_RANK: Record<MemberRole, number> = {
	owner: 0,
	client: 1,
	admin: 2,
	manager: 3,
	freelancer: 4,
	member: 5,
	guest: 6,
};

/** UTC month abbreviations for {@link dateLabel}. The fixture's vocabulary, verbatim. */
const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;

const DAY_MS = 86_400_000;

/**
 * A hard ceiling on the ticket rows scanned for the workload column.
 *
 * The counts are computed in TS over ONE query rather than as N per-assignee `count` requests, so the
 * scan needs a bound. PostgREST's own `max_rows = 1000` would impose one anyway; stating it here makes
 * the number visible to a reader instead of a property of a config file three directories away. Above
 * it the figures under-report, which is the safe direction to be wrong: a workload that reads low
 * invites a second look, one that reads high blocks an assignment that should have proceeded.
 */
const TICKET_SCAN_CAP = 1000;

// #endregion

// #region Row shapes

/** One `projects.projects` row, restricted to {@link PROJECT_COLUMNS}. */
interface ProjectRow {
	id: string;
	slug: string;
	title: string;
	format: string;
	owner_user_id: string;
	created_at: string;
}

/** One `projects.project_participants` row. `role` is unconstrained free text — see {@link toMemberRole}. */
interface ParticipantRow {
	id: string;
	profile_type: string;
	profile_id: string;
	role: string;
	created_at: string;
}

/** One `projects.project_stages` row, reduced to what the stage filter and picker need. */
interface StageRow {
	id: string;
	name: string | null;
	sort_order: number | null;
}

/** One `projects.stage_assignments` row. `status` is free text — see {@link HELD_ASSIGNMENT_STATUS}. */
interface AssignmentRow {
	project_stage_id: string;
	assignee_type: string;
	freelancer_profile_id: string | null;
	status: string;
}

/** One `projects.project_invitations` row, as selected by {@link INVITATION_COLUMNS}. */
interface InvitationRow {
	id: string;
	project_stage_id: string | null;
	target_email: string;
	role: string;
	inviter_user_id: string;
	status: string;
	created_at: string;
	expires_at: string | null;
}

/** One `comms.project_channels` row, for the routed channel's identity. */
interface ChannelRow {
	id: string;
	project_id: string;
	name: string | null;
	stage_id: string | null;
}

/** One assembled roster row, still carrying the raw user id the projection itself drops. */
interface RosterEntry {
	userId: string;
	row: ProjectMemberRow;
}

/** A deduplicated seat, after the owner and the participant rows have been merged. */
interface Seat {
	id: string;
	userId: string;
	role: MemberRole;
	joinedAt: string;
}

// #endregion

// #region Labels

/**
 * Normalise a Postgres `timestamptz` to a canonical ISO-8601 `Z` string.
 *
 * Two reasons, both load-bearing. PostgREST serialises the column as `+00:00` rather than `Z`, and the
 * roster sorts on `joinedAt` LEXICOGRAPHICALLY — which is chronological only for a fixed-width UTC
 * form, so the two spellings would interleave. And an unparseable value has to resolve to something a
 * consumer can read: the epoch is a visibly wrong date rather than a string that throws on the client,
 * which is the difference between a row that looks odd and a page that does not render.
 */
function toIso(raw: string | null | undefined): string {
	const ms = raw ? Date.parse(raw) : NaN;
	return new Date(Number.isNaN(ms) ? 0 : ms).toISOString();
}

/**
 * An absolute date label ("Jul 14, 2026") in UTC.
 *
 * `getUTC*` rather than `Intl` because the server renders this string and the client re-renders it
 * from the same `joinedAt`; a locale- or zone-aware formatter would produce two different answers for
 * one row and flicker on hydration.
 */
function dateLabel(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/**
 * A relative age label ("2 days ago") against a single per-request clock.
 *
 * Day granularity is what makes this SSR-stable without the fixtures' frozen reference clock: the
 * server's answer and the client's refetch a few seconds later land in the same bucket. `nowMs` is
 * threaded in rather than read here so that every label in one response shares one instant —
 * otherwise two invitations either side of a midnight boundary would be formatted against two
 * different days.
 */
function agoLabel(iso: string, nowMs: number): string {
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return "";
	const days = Math.round(Math.max(0, nowMs - then) / DAY_MS);
	if (days <= 0) return "Today";
	if (days === 1) return "Yesterday";
	if (days < 7) return `${days} days ago`;
	const weeks = Math.round(days / 7);
	return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
}

/** The roster's pre-formatted workload cell. `—` rather than `0 open`, matching the fixture. */
function ticketsLabel(count: number): string {
	return count > 0 ? `${count} open` : "—";
}

/**
 * Coerce a `project_format` value onto the Zod enum.
 *
 * The two vocabularies agree today (`one_off` | `pipeline` | `session`), so this guards against a
 * future member reaching a client as an unparseable row rather than translating between them. An
 * unknown member degrades to `pipeline`, the column's own default.
 */
function toFormat(raw: string | null | undefined): ProjectFormat {
	return raw === "one_off" || raw === "session" ? raw : "pipeline";
}

// #endregion

// #region Viewer capabilities

/**
 * The management gate for a role — Client · Owner · Admin · Manager oversee; everyone else does not.
 *
 * Re-derived server-side from the role this module resolved out of the database, never accepted from
 * the client (root CLAUDE.md §6). The four flags below the master gate move together today: the
 * authority TIER that separates a manager from an owner (a manager must not be able to demote the
 * person who appointed them) is a rule the write path will enforce, and inventing a finer read-side
 * split here would advertise a distinction no mutation honours yet — an affordance offered and then
 * refused.
 */
function capsFor(role: MemberRole): MemberViewerCaps {
	const manages = LEADERSHIP_ROLES.has(role);
	return {
		canManage: manages,
		canInvite: manages,
		canAssign: manages,
		canEditRoles: manages,
		canRemove: manages,
	};
}

// #endregion

// #region Secondary lookups

/**
 * The project's stages, in board order.
 *
 * A failure degrades to `[]` rather than throwing: `stages` drives a filter and a picker, and a roster
 * that renders without its stage filter is strictly better than a page that 500s because one
 * secondary read was refused. The consequence is visible — an empty picker — rather than silent.
 */
async function fetchStages(db: SupabaseClient, projectId: string): Promise<StageRow[]> {
	const { data, error } = await db
		.from("project_stages")
		.select("id, name, sort_order")
		.eq("project_id", projectId)
		.order("sort_order", { ascending: true });
	if (error) return [];
	return (data ?? []) as unknown as StageRow[];
}

/**
 * Held stage assignments across the project's stages, keyed `user_id → Set<stage_id>`.
 *
 * `freelancer_profile_id` is a FK to `org.freelancer_profiles(user_id)`, so it IS a user id and joins
 * straight onto the roster with no translation. A `team` assignment carries `team_id` instead and
 * names no person; it is skipped for the same reason a business participant is (module docblock), so a
 * team's seats are ABSENT from the per-person `assignedStages` column rather than attributed to
 * whoever happens to be in the team.
 */
async function fetchAssignments(
	db: SupabaseClient,
	stageIds: readonly string[],
): Promise<Map<string, Set<string>>> {
	const byUser = new Map<string, Set<string>>();
	if (stageIds.length === 0) return byUser;

	const { data, error } = await db
		.from("stage_assignments")
		.select("project_stage_id, assignee_type, freelancer_profile_id, status")
		.in("project_stage_id", stageIds as string[])
		.in("status", HELD_ASSIGNMENT_STATUS as string[]);
	if (error) return byUser;

	for (const row of (data ?? []) as unknown as AssignmentRow[]) {
		if (row.assignee_type !== "freelancer" || !row.freelancer_profile_id) continue;
		const held = byUser.get(row.freelancer_profile_id) ?? new Set<string>();
		held.add(row.project_stage_id);
		byUser.set(row.freelancer_profile_id, held);
	}
	return byUser;
}

/**
 * Open ticket counts per assignee, in one scan of the project's tickets.
 *
 * One query rather than one per member: the N+1 here would be a round trip per roster row to render a
 * single column. A failure degrades to an empty map, which renders every workload cell as `—` — the
 * same thing an unstaffed project shows, and the honest reading of "we do not know".
 */
async function fetchOpenTicketCounts(
	db: SupabaseClient,
	projectId: string,
	userIds: readonly string[],
): Promise<Map<string, number>> {
	const counts = new Map<string, number>();
	if (userIds.length === 0) return counts;

	const { data, error } = await db
		.from("tickets")
		.select("current_assignee_id")
		.eq("project_id", projectId)
		.in("current_assignee_id", userIds as string[])
		.in("status", OPEN_TICKET_STATUS as string[])
		.limit(TICKET_SCAN_CAP);
	if (error) return counts;

	for (const row of (data ?? []) as { current_assignee_id: string | null }[]) {
		const id = row.current_assignee_id;
		if (!id) continue;
		counts.set(id, (counts.get(id) ?? 0) + 1);
	}
	return counts;
}

/**
 * The acting viewer's own primary email, or `""`.
 *
 * `org.users_public` has NO email column at all — the address lives in `org.user_emails`, whose SELECT
 * policy is `user_id = auth.uid() OR security.is_admin()`. So the table IS safely readable, and it is
 * readable for EXACTLY ONE PERSON: the caller. There is no query, and no policy arm, that returns a
 * colleague's address to an ordinary project owner.
 *
 * That is why every other row's `email` is the empty string rather than a value derived from something
 * adjacent. The field is `z.string().max(160)` with no `min(1)`, so `""` is the schema's own neutral
 * value — `null` is not assignable to it and would fail the parse. The fixture composes
 * `handle@projective.app`, which is a plausible address that is not this person's, and a roster that
 * offers a wrong contact is worse than one that offers none.
 *
 * **A consequence worth stating rather than leaving to be discovered:** on the live path this column
 * is not a contact channel. A surface that renders it as a `mailto:` produces exactly one working link
 * — the viewer's own — and a dead cell beside every colleague.
 */
async function fetchViewerEmail(actor: ReadActor & { accessToken: string }): Promise<string> {
	if (!actor.userId) return "";
	const { data, error } = await orgDb(actor)
		.from("user_emails")
		.select("email, is_primary")
		.eq("user_id", actor.userId);
	if (error) return "";
	const rows = (data ?? []) as { email: string | null; is_primary: boolean | null }[];
	const chosen = rows.find((row) => row.is_primary) ?? rows[0];
	return clamp(chosen?.email, 160);
}

/**
 * The routed channel's identity, or `null` when the segment does not name one.
 *
 * Three ways this legitimately returns `null`, none of them an error: the roster was reached at
 * `/projects/{slug}/members` with no channel at all; the segment is not a uuid, so it cannot be
 * compared against a `uuid` column without raising `22P02` (the cast trap {@link UUID_RE} guards); or
 * the channel exists but belongs to another project, which the explicit `project_id` predicate
 * refuses. Each collapses to PROJECT scope, which is the correct reading of "no channel".
 *
 * **`ChannelKind` has four members and this table can express two.** `comms.project_channels` carries
 * `stage_id` and `visibility` and nothing else that discriminates: a stage channel is one with a
 * `stage_id`, and everything else is `general`. There is no team-channel column, and a DM is not in
 * this table at all — it is `comms.dm_threads`, a different read entirely. So `team` and `dm` are
 * unreachable from here rather than forgotten.
 */
async function resolveChannel(
	actor: ReadActor & { accessToken: string },
	projectId: string,
	channelId: string | null,
): Promise<ChannelRow | null> {
	if (!channelId || !UUID_RE.test(channelId)) return null;
	const { data, error } = await commsDb(actor)
		.from("project_channels")
		.select("id, project_id, name, stage_id")
		.eq("id", channelId)
		.eq("project_id", projectId)
		.maybeSingle();
	if (error || !data) return null;
	return data as unknown as ChannelRow;
}

/**
 * The pending-invitation queue.
 *
 * Called ONLY for a managing viewer, and on this table that is a security control rather than a UI
 * nicety: RLS is disabled and `authenticated` holds a blanket grant (module docblock, point 2), so
 * nothing below this function withholds another participant's invitee list.
 *
 * Two status shapes are reconciled. {@link toInviteStatus} drops `accepted` and `revoked`, which are
 * resolved states with no representation in the Zod enum and no business in a PENDING queue.
 * Separately, a row may still say `pending` while its `expires_at` has passed — the column comment is
 * explicit that expiry is a timestamp precisely so a reader can tell "expires next Tuesday" from
 * "expired last Tuesday" without a sweep having run, and `status = 'expired'` is only the sweep's
 * record that it noticed. The timestamp therefore wins over the flag.
 *
 * A failure degrades to `[]`: an empty queue is what a project with no outstanding invitations shows,
 * and a roster is still a roster without it.
 */
async function fetchInvitations(
	actor: ReadActor & { accessToken: string },
	db: SupabaseClient,
	projectId: string,
	stageNames: ReadonlyMap<string, string>,
	nowMs: number,
): Promise<MemberInvite[]> {
	const { data, error } = await db
		.from("project_invitations")
		.select(INVITATION_COLUMNS)
		.eq("project_id", projectId)
		.order("created_at", { ascending: false });
	if (error) return [];

	const rows = (data ?? []) as unknown as InvitationRow[];
	const open = rows.filter((row) => toInviteStatus(row.status) !== null);
	if (open.length === 0) return [];

	const inviters = await fetchParties(actor, open.map((row) => row.inviter_user_id));

	return open.map((row) => {
		const declared = toInviteStatus(row.status) ?? "pending";
		const lapsed = row.expires_at ? Date.parse(row.expires_at) <= nowMs : false;
		const invitedAt = toIso(row.created_at);
		const stageId = row.project_stage_id;
		return {
			id: clampOr(row.id, 120, "invitation"),
			email: clamp(row.target_email, 160),
			// The CHECK on this column allows exactly the seven `MemberRole` members, so the round trip
			// is lossless — but it is still routed through the shared mapping rather than cast, because
			// a CHECK is not an enum and nothing stops a future migration widening it.
			role: toMemberRole(row.role),
			stageId: stageId ? clamp(stageId, 120) : null,
			stageName: stageId ? (stageNames.get(stageId) ?? null) : null,
			invitedBy: clamp(partyName(inviters.get(row.inviter_user_id)), 120),
			invitedAt,
			invitedLabel: clamp(agoLabel(invitedAt, nowMs), 28),
			status: declared === "expired" || lapsed ? "expired" : "pending",
		};
	});
}

// #endregion

// #region Roster assembly

/**
 * Merge the seeded owner with the project's participant rows into one deduplicated person list.
 *
 * The order of precedence is deliberate. The only role any migration writes into
 * `project_participants.role` is `'assignee'`, which {@link toMemberRole} resolves to `freelancer` —
 * so an owner who ALSO holds a participant row would be demoted to the person doing the work in their
 * own project. Seeding the owner first and refusing to overwrite them is what prevents that.
 */
function mergeParticipants(
	project: ProjectRow,
	participants: readonly ParticipantRow[],
): Seat[] {
	const seats = new Map<string, Seat>();

	seats.set(project.owner_user_id, {
		// No participant row exists for the owner, so there is no participant id to name. The prefix
		// keeps the two id namespaces distinguishable to a caller that will later aim a management
		// action at one of them and needs to know which table it addresses.
		id: `owner:${project.owner_user_id}`,
		userId: project.owner_user_id,
		role: "owner",
		joinedAt: toIso(project.created_at),
	});

	for (const row of participants) {
		// An entity participant is a workspace, not a person — module docblock. `profile_type` is
		// tested rather than left to a party lookup that would simply miss, so the exclusion reads as a
		// stated rule instead of a side effect of a join that happened to find nothing.
		if (row.profile_type !== "freelancer") continue;
		if (seats.has(row.profile_id)) continue;
		seats.set(row.profile_id, {
			id: clampOr(row.id, 120, row.profile_id),
			userId: row.profile_id,
			role: toMemberRole(row.role),
			joinedAt: toIso(row.created_at),
		});
	}

	return [...seats.values()];
}

/**
 * Build the projection rows, sorted authority-first.
 *
 * `assignment` (contributor vs observer) is resolved ONLY in channel scope on a STAGE channel, which
 * is the only place the distinction means anything: a general channel has no delivery relationship to
 * observe, and in project scope the per-stage picture is exactly what `assignedStages` summarises
 * instead.
 *
 * Within a stage channel every project participant is treated as PRESENT, and a non-assignee is an
 * `observer` rather than absent. `comms.project_channel_participants` exists but cannot answer the
 * membership question: it is keyed by `(profile_type, profile_id)` — a profile, not a user — carries
 * no `user_id`, and is consulted by no policy, which is the same reason `live-support` gives for the
 * project side having no unread signal.
 *
 * A user id with no `org.users_public` row keeps its seat under the "Unknown" placeholder `partyOf`
 * already draws. That absence is a real state (RLS can withhold a public profile from a viewer who can
 * still see the engagement), and dropping the row would under-report the size of the team.
 */
function buildRows(
	seats: readonly Seat[],
	parties: ReadonlyMap<string, PartyRow>,
	assignments: ReadonlyMap<string, Set<string>>,
	stageNames: ReadonlyMap<string, string>,
	tickets: ReadonlyMap<string, number>,
	viewerUserId: string,
	viewerEmail: string,
	channelStageId: string | null,
): RosterEntry[] {
	const entries: RosterEntry[] = seats.map(({ id, userId, role, joinedAt }) => {
		const held = assignments.get(userId);
		const assignedStages = held
			? [...held]
				.map((stageId) => stageNames.get(stageId))
				.filter((name): name is string => !!name)
			: [];
		const openTickets = tickets.get(userId) ?? 0;
		const isViewer = viewerUserId.length > 0 && userId === viewerUserId;

		let assignment: StageAssignment | null = null;
		if (channelStageId) assignment = held?.has(channelStageId) ? "contributor" : "observer";

		const row: ProjectMemberRow = {
			id,
			party: partyOf(parties.get(userId)),
			// Only the caller's own address is readable — see `fetchViewerEmail`. Everyone else carries
			// the schema's neutral empty string rather than a plausible invention.
			email: isViewer ? viewerEmail : "",
			role,
			assignment,
			presence: NO_PRESENCE_SIGNAL,
			assignedStages,
			openTickets,
			ticketsLabel: clamp(ticketsLabel(openTickets), 24),
			joinedAt,
			joinedLabel: clamp(dateLabel(joinedAt), 28),
			isViewer,
		};
		return { userId, row };
	});

	// Authority first, then join order, then name. `joinedAt` is compared lexicographically, which is
	// chronological because `toIso` normalises every value to the same fixed-width UTC form.
	return entries.sort((a, b) => {
		const rank = ROLE_RANK[a.row.role] - ROLE_RANK[b.row.role];
		if (rank !== 0) return rank;
		if (a.row.joinedAt !== b.row.joinedAt) return a.row.joinedAt < b.row.joinedAt ? -1 : 1;
		return a.row.party.name.localeCompare(b.row.party.name);
	});
}

/**
 * The access-visibility rule: an oversight role sees every participant; a delivery or observer role
 * sees leadership plus the people they actually work alongside.
 *
 * Applied server-side rather than left to the client because the database will not apply it. The
 * SELECT policy on `projects.project_participants` is owner-or-public-project, so on a PUBLIC
 * engagement the whole roster is readable by anyone signed in and RLS withholds nothing — this rule is
 * the only thing standing between a `guest` and every collaborator's name.
 *
 * `total` deliberately counts the UNFILTERED roster, exactly as the schema documents it ("Total
 * participants … independent of any client-side filter"), so the caption stays truthful about the size
 * of the team even where the list itself is narrowed.
 */
function visibleTo(
	entries: readonly RosterEntry[],
	caps: MemberViewerCaps,
	viewerAssigned: boolean,
	scope: "channel" | "project",
	isStageChannel: boolean,
	viewerStages: readonly string[],
): ProjectMemberRow[] {
	if (caps.canManage) return entries.map((entry) => entry.row);
	const publicChannel = scope === "channel" && !isStageChannel;
	return entries
		.filter(({ row }) => {
			if (row.isViewer) return true;
			if (LEADERSHIP_ROLES.has(row.role)) return true;
			// An unassigned contributor has no colleagues to see — only the people who can hire them.
			if (!viewerAssigned) return false;
			if (publicChannel) return true;
			if (scope === "channel") return row.assignment !== null;
			return row.assignedStages.some((name) => viewerStages.includes(name));
		})
		.map((entry) => entry.row);
}

// #endregion

// #region Public read

/**
 * The Members roster for a project, or for one of its channels — the live counterpart of
 * `findMemberRoster`.
 *
 * Returns `null` when the engagement does not exist or is not visible to this caller; the two are
 * indistinguishable from here by design, and both are an ordinary 404 on this route. Throws only when
 * a query genuinely FAILS, naming the table so the calling service can log which read broke before it
 * falls back to the fixture corpus.
 *
 * The three `sim*` params are ignored, as {@link MemberRosterParams} documents: the real viewer role,
 * the real `project_format` and the real invitation table are authoritative here. Honouring a
 * client-supplied role override on a path that decides what a person may SEE would turn a developer
 * convenience into a privilege-forgery primitive.
 */
export async function fetchMemberRoster(
	actor: ReadActor & { accessToken: string },
	params: MemberRosterParams,
): Promise<MemberRosterPage | null> {
	const db = projectsDb(actor);
	const nowMs = Date.now();

	// The route segment is a SLUG (`/projects/[projectId]` addresses by slug), but a uuid is also a
	// legal slug shape, so the operand is tested rather than assumed — see UUID_RE for the cast trap.
	// `maybeSingle` rather than `single`: a segment matching nothing is a 404, and `single` turns that
	// into a thrown PostgREST error the caller would have to unwrap to tell "no such project" apart
	// from "the database is down".
	const byId = UUID_RE.test(params.projectId);
	const found = await db
		.from("projects")
		.select(PROJECT_COLUMNS)
		.eq(byId ? "id" : "slug", params.projectId)
		.maybeSingle();

	if (found.error) throw new Error(`projects.projects roster read failed: ${found.error.message}`);
	if (!found.data) return null;
	const project = found.data as unknown as ProjectRow;

	const roster = await db
		.from("project_participants")
		.select(PARTICIPANT_COLUMNS)
		.eq("project_id", project.id);
	// Zero rows is a legitimate answer — the participant-visibility hole in the module docblock
	// produces exactly that for a freelancer on a private engagement — but an ERROR is a failed read,
	// and rendering a roster of one when the participant list could not be fetched would be an
	// invention rather than a degradation. This is the endpoint's substance, so it throws.
	if (roster.error) {
		throw new Error(`projects.project_participants read failed: ${roster.error.message}`);
	}
	const participants = (roster.data ?? []) as unknown as ParticipantRow[];

	const stageRows = await fetchStages(db, project.id);
	const stages: MemberStageRef[] = stageRows.map((stage) => ({
		id: clampOr(stage.id, 120, "stage"),
		name: clampOr(stage.name, 120, "Untitled stage"),
	}));
	const stageNames = new Map(stages.map((stage) => [stage.id, stage.name]));

	const seats = mergeParticipants(project, participants);
	const userIds = seats.map((seat) => seat.userId);

	// Five independent lookups over one already-resolved project. Issued together rather than in
	// series: none depends on another's result, and awaiting them one at a time would add all five
	// latencies to every roster render.
	const [parties, assignments, tickets, viewerEmail, channel] = await Promise.all([
		fetchParties(actor, userIds),
		fetchAssignments(db, stageRows.map((stage) => stage.id)),
		fetchOpenTicketCounts(db, project.id, userIds),
		fetchViewerEmail(actor),
		resolveChannel(actor, project.id, params.channelId ?? null),
	]);

	const scope: "channel" | "project" = channel ? "channel" : "project";
	const channelStageId = channel?.stage_id ?? null;
	const channelKind: ChannelKind | null = channel ? (channel.stage_id ? "stage" : "general") : null;

	const entries = buildRows(
		seats,
		parties,
		assignments,
		stageNames,
		tickets,
		actor.userId,
		viewerEmail,
		channelStageId,
	);

	// The viewer's own row is the source of their role. A caller holding neither the owner seat nor a
	// participant row — a stranger reading a public engagement — is a `guest`: the schema's own
	// "read-limited external observer" and the least-privileged member of the union, so an identity we
	// could not resolve is never promoted into an authority tier by accident.
	const self = entries.find((entry) => entry.row.isViewer);
	const viewerRole: MemberRole = self?.row.role ?? "guest";
	const viewerCaps = capsFor(viewerRole);
	const viewerStages = self?.row.assignedStages ?? [];
	// In a stage channel "assigned" means assigned to THIS stage; in project scope it means holding any
	// stage at all. The two questions are different and a single flag would answer the wrong one on
	// whichever surface it was not written for.
	const viewerAssigned = channelStageId
		? self?.row.assignment === "contributor"
		: viewerStages.length > 0;

	const members = visibleTo(
		entries,
		viewerCaps,
		viewerAssigned,
		scope,
		!!channelStageId,
		viewerStages,
	);

	// The queue is a management concern AND, on this table, an access control — see `fetchInvitations`.
	const invites = viewerCaps.canInvite
		? await fetchInvitations(actor, db, project.id, stageNames, nowMs)
		: [];

	return {
		scope,
		projectId: clampOr(params.projectId, 120, project.slug),
		channelId: channel ? clamp(channel.id, 120) : null,
		channelName: channel ? clamp(channel.name, 160) : null,
		channelKind,
		projectTitle: clampOr(project.title, 160, "Untitled project"),
		format: toFormat(project.format),
		members,
		invites,
		stages,
		// `""` when the caller holds no seat: the field is `max(120)` with no `min`, so the empty string
		// is the schema's own "no row here is yours" and the surface's "You" marker matches nothing.
		viewerId: self ? clamp(self.row.id, 120) : "",
		viewerRole,
		viewerCaps,
		// Deliberately the unfiltered count — see `visibleTo`.
		total: entries.length,
	};
}

// #endregion
