import type { SupabaseClient } from "supabaseClient";
import { getUserClient } from "../../core/supabase.ts";
import { fetchPublicMedia, mediaUrl } from "../files/public-media.ts";
import type { ReadActor } from "../read-actor.ts";
import type {
	ChannelKind,
	ProjectChannel,
	ProjectDetail,
	ProjectMember,
	ProjectParty,
	ProjectSummary,
	ProjectViewerRole,
	StageChannel,
	TeamChannel,
} from "@projective/types/projects";
import type { PartyRow } from "./live-support.ts";
import {
	clamp,
	clampOr,
	commsDb,
	fetchParties,
	NO_UNREAD_SIGNAL,
	orgDb,
	partyOf,
	projectsDb,
	toMemberRole,
	toProjectStructure,
	toStageProjectStatus,
} from "./live-support.ts";
import { fetchProjectBySlug } from "./live-queries.ts";

/**
 * live-detail — the RLS-scoped Postgres read path for `ProjectBackendService.detail(slug)`, the deep
 * single-engagement projection behind the Project Details sidebar.
 *
 * ## The detail is the summary plus a graph, and it is built that way on purpose
 *
 * `ProjectDetailSchema` is a strict superset of `ProjectSummarySchema` for eleven of its fields —
 * `id`, `slug`, `title`, `kind`, `format`, `status`, `viewerRole`, `scopeType`, `scopeLabel`,
 * `starred` and `owner` all mean exactly what they mean on the feed card. So this module resolves
 * them by CALLING {@link fetchProjectBySlug} rather than re-deriving them, and adds only what the
 * sidebar needs on top: the description, the client party, the roster and the four-group channel
 * tree.
 *
 * That is not merely tidy. Every one of those eleven fields is the output of a decision already
 * written down once — which of `owner_organisation_id` / `owner_team_id` / `client_business_id` wins
 * the scope race, whether a `source_blueprint_id` makes an engagement a service, which
 * `project_status` members the Zod enum can express, and how three separate `org` tables resolve a
 * workspace's human name. Re-deriving them here would be a second implementation of all five, and the
 * failure mode of a drifting second implementation is not an error: it is a sidebar that quietly
 * disagrees with the card the reader clicked to reach it. The fixtures state that invariant
 * explicitly ("the detail view always agrees with the card that linked to it"), and reuse is how the
 * live path keeps it.
 *
 * The cost is one redundant `projects.projects` lookup by slug (a unique-index hit) and one redundant
 * `project_stages` count read. That is the price of not maintaining the same rules twice, and it is
 * the cheaper half of the trade.
 *
 * ## Where a failure throws and where it degrades
 *
 * The line is drawn at whether the page would ASSERT something false:
 *
 * - The project row itself throws — delegated to {@link fetchProjectBySlug}, which raises for a
 *   genuine query failure and returns `null` for a slug that matches nothing.
 * - `projects.project_stages` and `comms.project_channels` also throw. They are the SUBSTANCE of this
 *   projection: a sidebar rendered without them says "this engagement has no stages and no channels",
 *   which is a statement about the engagement rather than about the read. Throwing hands the caller
 *   its fixture fallback instead.
 * - Everything else — participants, stage assignments, team and business names, display parties, the
 *   description enrichment — degrades to a neutral value. A roster short one name, or a team group
 *   labelled "Team" rather than "Design Guild", is a page that is less specific. It is not a page that
 *   is wrong.
 *
 * ## What RLS actually hands back here, and why parts of the tree can be empty
 *
 * `comms.project_channels` SELECT is gated by `comms.has_channel_access` → `comms.can_access_scope`,
 * so the rows that arrive are already exactly the rooms this viewer may enter. This module never
 * filters for access; it only GROUPS what came back. That is the whole reason the private-room
 * grouping below can be permissive without leaking anything.
 *
 * `projects.project_participants` and `projects.stage_assignments`, by contrast, are readable only by
 * the project OWNER or on an `active` + `public` project (`00002011_policies_projects.sql`). A hired
 * freelancer on a private engagement therefore reads an EMPTY roster — not an error, just nothing —
 * so the members list degrades to the owner alone. That is the same missing-policy gap the feed read
 * records in `documentation/architecture/READ_API_FINDINGS.md`, seen from a second angle. The Teams
 * group does not depend on it: which hired teams the viewer is on comes from
 * `projects.get_viewer_hired_teams`, which answers for the caller's own memberships only.
 */

// #region Row shapes

/** The `projects.projects` columns this projection needs BEYOND the ones the summary already carries. */
interface DetailRow {
	owner_user_id: string;
	description_text: string | null;
	client_business_id: string | null;
	structure_variation: string | null;
}

/** One `projects.project_stages` row, reduced to what the stage tree renders. */
interface StageRow {
	id: string;
	/** The stage's `stg-…` route address — see {@link StageChannelSchema.slug}. */
	slug: string;
	name: string;
	sort_order: number;
	status: string;
}

/**
 * One `projects.project_participants` row.
 *
 * `profile_id` is polymorphic on `profile_type`, whose enum is `('freelancer', 'business')` — there is
 * no `'user'` member. A `freelancer` row carries a USER id and resolves through `org.users_public`; a
 * `business` row carries a BUSINESS id and resolves through `org.business_profiles`. Passing a
 * business id to the user lookup does not fail, it simply matches nothing and renders as "Unknown",
 * which is why the two are resolved separately below rather than through one party map.
 */
interface ParticipantRow {
	id: string;
	profile_type: string;
	profile_id: string;
	role: string;
}

/** One `comms.project_channels` row. `stage_id` discriminates a project room from a stage room. */
interface ChannelRow {
	id: string;
	name: string;
	stage_id: string | null;
	visibility: string;
	created_at: string;
}

/**
 * One `projects.get_viewer_hired_teams` row: a stage held by a team the viewer is an active member of.
 *
 * It is also how a `team_private` room is attributed to a team: `comms.project_channels` has a
 * `stage_id` and a `visibility` and no team column at all.
 */
interface HiredTeamRow {
	team_id: string;
	project_stage_id: string;
}

/** A resolved `org.business_profiles` row — the columns a party projection needs. */
interface BusinessRow {
	name: string;
	slug: string;
	/** `logo_file_id` — resolved to a URL by {@link fetchMarks}, never composed here. */
	logoFileId: string | null;
}

/** A resolved `org.teams` row. */
interface TeamRow {
	name: string;
	/** `avatar_file_id` — resolved to a URL by {@link fetchMarks}. */
	avatarFileId: string | null;
}

/** The longest avatar URL a party projection carries; a longer one is dropped, never truncated. */
const MARK_URL_MAX = 400;

// #endregion

// #region Vocabulary

/**
 * The stage-scoped values of `comms.project_channels.visibility`.
 *
 * The column is free text with no CHECK, written in exactly two places
 * (`comms.get_or_create_project_channel` and `comms.get_stage_channels`) and read as a three-way
 * branch by `comms.can_access_scope`. `project_all` is the whole-project room; these three are the
 * stage rooms — the shared one, the talent-side private one, and the client-side private one.
 */
const VIS_TEAM_PRIVATE = "team_private";
const VIS_BUSINESS_PRIVATE = "business_private";

/**
 * The participant roles that put a seat on the CLIENT side of a hire. See {@link resolveViewerIsClient}.
 *
 * Enumerated positively rather than by excluding the provider side. `viewerIsClient` gates an ACCESS
 * decision, so an unrecognised role must land on "not the client" — and the only value any migration
 * ever writes into this column is `'assignee'`, which is squarely provider side.
 */
const CLIENT_SIDE_ROLES: ReadonlySet<string> = new Set(["client", "owner", "admin", "manager"]);

/** The group label for talent-side rooms whose team could not be named. Never a bare id. */
const UNNAMED_TEAM = "Team";

/** The group label for client-side rooms whose business could not be named. Never a bare id. */
const UNNAMED_CLIENT = "Client";

// #endregion

// #region Derivation

/**
 * The human type badge beside the engagement title.
 *
 * `typeLabel` is `min(1)`, so a null derivation is not a missing badge — it is a thrown page read. A
 * real fallback is therefore mandatory, and no column can supply a better one:
 *
 * - `projects.projects.industry_category_id` looks like the answer and is not. It has no foreign key,
 *   and no category table exists in any migration, so there is nothing to join it to.
 * - `source_blueprint_id` points into `marketplace.service_blueprints`, whose title would be the ideal
 *   label — but `marketplace` is NOT in the schemas `supabase/config.toml` exposes, so PostgREST can
 *   neither read nor embed it. Its mere PRESENCE is what the summary already used to decide `kind`,
 *   and presence is all that survives the exposure boundary.
 *
 * So the label is composed from the two facts that ARE durable: the delivery `format` and the
 * client-vs-provider `kind`. That is a truthful description of the engagement rather than an invented
 * discipline — the fixtures' "Coaching" for a session is corpus flavour, not something a session row
 * asserts about itself.
 */
function typeLabelFor(summary: ProjectSummary): string {
	const noun = summary.kind === "service" ? "Service" : "Project";
	if (summary.format === "session") return "Session";
	if (summary.format === "one_off") return `One-off ${noun}`;
	return noun;
}

/**
 * Whether the acting user is the client/creator of the engagement.
 *
 * This one flag fans out to four consumers, and one of them is an access decision: it gates the
 * client-only "Create New Stage" affordance on the Stages group. So it is derived from the
 * participant/owner graph on the server and never inferred from anything a client supplies.
 *
 * The derivation deliberately mirrors `projects.can_review_project(_project_id)` — the database's own
 * definition of the client side — in the half that is reachable from here:
 *
 * - **Ownership is the primary signal.** `owner_user_id` is the seat that posted the project, or that
 *   instantiated a service blueprint into its own workspace; either way it is the buying side, and it
 *   is the first clause of `can_review_project`.
 * - **A participant row decides the rest**, and only for a role that is explicitly client-side. The
 *   single value the staffing RPC writes is `'assignee'`, the freelancer who was hired, so anything
 *   unrecognised falls to `false` rather than to `true`.
 *
 * The half that is NOT reachable is `can_review_project`'s second clause,
 * `org.is_active_business_member(client_business_id)`: an active member of the paying business is
 * client-side too, and answering that needs an `org.business_members` read this projection does not
 * otherwise perform. Such a viewer reads as `false` here — under-granting a create affordance, which
 * is the direction a capability flag should be wrong in.
 */
function resolveViewerIsClient(
	actor: ReadActor,
	ownerUserId: string,
	participants: readonly ParticipantRow[],
): boolean {
	if (actor.userId.length > 0 && actor.userId === ownerUserId) return true;
	const own = participants.find((row) => row.profile_id === actor.userId);
	return isClientSideRole(own?.role);
}

/**
 * Whether a participant role puts its holder on the CLIENT side of a hire — the one rule
 * {@link resolveViewerIsClient} applies, exported so another surface of the same engagement (its
 * calendar) cannot come to disagree about which side of the table a person sits on.
 */
export function isClientSideRole(role: string | null | undefined): boolean {
	return !!role && CLIENT_SIDE_ROLES.has(role.trim().toLowerCase());
}

/**
 * A participant's `role` narrowed to {@link ProjectViewerRole}.
 *
 * `ProjectMemberSchema.role` is `ProjectViewerRole` — `owner | admin | freelancer | client | member` —
 * which is NOT the seven-member `MemberRole` that {@link toMemberRole} returns. Two of those seven
 * have no representation here, and passing them straight through fails the parse:
 *
 * - `manager` becomes `admin`. A manager is an authority tier, and `admin` is the only one this union
 *   offers; collapsing it to `member` would strip a seat of its standing on the roster.
 * - `guest` becomes `member`, the least-privileged option.
 *
 * Everything else is delegated so the load-bearing `'assignee' → freelancer` mapping stays written
 * down exactly once, next to the migration line that justifies it.
 */
function toMemberViewerRole(raw: string | null | undefined): ProjectViewerRole {
	const role = toMemberRole(raw);
	switch (role) {
		case "owner":
		case "admin":
		case "client":
		case "freelancer":
			return role;
		case "manager":
			return "admin";
		default:
			return "member";
	}
}

// #endregion

// #region Channel tree

/**
 * Map a `comms.project_channels` row onto a {@link ProjectChannel}.
 *
 * **`chatId` is the channel's own id, and that is the correct unified thread identity here.** On a DM
 * the two differ — a DM row points at a `comms.dm_threads` record shared with the global inbox — but a
 * project room has no separate thread: `comms.project_messages.channel_id` IS the FK, so the channel
 * row is the conversation. Emitting the uuid for both means every id in this projection round-trips to
 * a real primary key, which is what the sidebar's `channelHref(slug, id)` needs to produce a link that
 * resolves.
 *
 * `unread` is `NO_UNREAD_SIGNAL`: a project channel has no per-viewer read watermark anywhere in the
 * schema (`comms.project_channel_participants` is keyed by profile with no `last_read_at`, while the
 * DM side has one), so there is nothing to compare against.
 */
function toProjectChannel(
	row: ChannelRow,
	kind: ChannelKind,
	sublabel: string | null,
): ProjectChannel {
	return {
		id: row.id,
		chatId: row.id,
		name: clampOr(row.name, 120, "Channel"),
		kind,
		sublabel: sublabel ? clamp(sublabel, 120) : null,
		unread: NO_UNREAD_SIGNAL,
	};
}

/**
 * Partition the visible channels by the group they belong to.
 *
 * A channel with no `stage_id` is a whole-project room (the writers only ever give those
 * `project_all`). A channel WITH one is a stage room, and its `visibility` says which of the three:
 * the shared room, the talent-side private room, or the client-side private room. An unrecognised
 * visibility on a stage room is treated as the shared room — the same fallback
 * `comms.can_access_scope` takes in its own `ELSE` branch, so a value neither side has seen before is
 * read identically by the gate and by the tree.
 */
function partitionChannels(rows: readonly ChannelRow[]): {
	general: ChannelRow[];
	stageAll: Map<string, ChannelRow>;
	privateRooms: ChannelRow[];
} {
	const general: ChannelRow[] = [];
	const stageAll = new Map<string, ChannelRow>();
	const privateRooms: ChannelRow[] = [];

	for (const row of rows) {
		if (!row.stage_id) {
			general.push(row);
			continue;
		}
		if (row.visibility === VIS_TEAM_PRIVATE || row.visibility === VIS_BUSINESS_PRIVATE) {
			privateRooms.push(row);
			continue;
		}
		// `stage_all`, or anything unrecognised. First writer wins: the rows arrive ordered by
		// `created_at`, and `comms.get_or_create_project_channel` dedupes on
		// (project, stage, visibility), so a second row for one stage is an anomaly rather than a
		// choice this read should arbitrate.
		if (!stageAll.has(row.stage_id)) stageAll.set(row.stage_id, row);
	}

	return { general, stageAll, privateRooms };
}

/**
 * The Stages group: one entry per stage, carrying that stage's shared room.
 *
 * **A stage with no visible room is OMITTED, and that is a deliberate loss.** The sidebar's stage row
 * builds its href from `StageChannel.id` — not from `stage.channel.id` — so that id must be a channel
 * route segment that resolves, exactly as the fixtures make the two equal. `comms.get_stage_channels`
 * provisions a stage's three rooms LAZILY, on first open, so a stage nobody has opened genuinely has
 * no room yet and no id that would round-trip. Rendering it anyway would produce a styled, focusable
 * link that reaches nothing, which root CLAUDE.md §3 gate 11 treats as a defect of the same class as a
 * broken link; and this read path cannot provision one, because provisioning is a write.
 *
 * `order` is the stage's POSITION among all stages sorted by `sort_order`, not the raw column: the
 * schema documents a 0-based display order and `sort_order` is an unconstrained `integer` that can be
 * 1-based, sparse or negative — and `min(0)` would throw on the last of those. Positions stay attached
 * to the full pipeline rather than to the filtered array, so an omitted stage leaves a gap instead of
 * silently renumbering the ones after it.
 *
 * `activity` carries only what a stage row can prove. `stage_status` has a `revisions` member, which
 * IS the client having asked for changes, so that maps straight onto `revision_requested`. The other
 * two signals do not: `new_ticket` would need a per-stage `projects.tickets` scan and `stage_invite` a
 * per-viewer invitation read, neither of which this projection performs — so they are left `null`
 * rather than approximated from something adjacent. A status glyph is an instruction to act, and an
 * invented one sends the reader somewhere there is nothing to do.
 *
 * The stage's name is pushed onto its channel rather than the channel's own being kept. That is what
 * `comms.get_stage_channels` writes anyway, but `comms.get_or_create_project_channel` accepts an
 * arbitrary label from its caller — and the tree row and the room it opens carrying two different
 * names for one stage reads as two places, not one.
 */
function buildStageChannels(
	stages: readonly StageRow[],
	stageAll: ReadonlyMap<string, ChannelRow>,
): StageChannel[] {
	const out: StageChannel[] = [];
	stages.forEach((stage, index) => {
		const room = stageAll.get(stage.id);
		if (!room) return;
		const name = clampOr(stage.name, 120, `Stage ${index + 1}`);
		out.push({
			id: room.id,
			// The three keys this function is the only place to hold at once — see `StageChannelSchema`.
			// `slug` is what a link carries; `id` is the room it opens; `stageId` is the row it configures.
			slug: stage.slug,
			stageId: stage.id,
			name,
			order: index,
			status: toStageProjectStatus(stage.status),
			activity: stage.status === "revisions" ? "revision_requested" : null,
			channel: toProjectChannel({ ...room, name }, "stage", null),
		});
	});
	return out;
}

/**
 * The Teams group: one entry per hired team the viewer is an active member of, carrying the stages it
 * holds and the talent rooms of those stages that have been provisioned.
 *
 * Built from the viewer's MEMBERSHIPS, not from the rooms. A room is provisioned lazily and says
 * nothing about teams — a solo freelancer's talent room and a team's look identical — so a group per
 * room would both miss a hired team whose room nobody has opened and invent a "team" around a
 * freelancer working alone. Client-side (`business_private`) rooms therefore have no group here.
 *
 * `avatar` is the team's mark as {@link fetchMarks} resolved it, or `null` for the initials fallback.
 */
function buildTeamChannels(
	hired: ReadonlyMap<string, readonly string[]>,
	privateRooms: readonly ChannelRow[],
	stageNames: ReadonlyMap<string, string>,
	teamNames: ReadonlyMap<string, string>,
	marks: ReadonlyMap<string, string>,
): TeamChannel[] {
	const talentRooms = privateRooms.filter((room) => room.visibility === VIS_TEAM_PRIVATE);
	const out: TeamChannel[] = [];

	for (const [teamId, stageIds] of hired) {
		const held = new Set(stageIds);
		const assignedStages: string[] = [];
		for (const stageId of stageIds) {
			const name = stageNames.get(stageId);
			if (name && !assignedStages.includes(name)) assignedStages.push(clamp(name, 120));
		}
		out.push({
			teamId: clampOr(teamId, 80, UNNAMED_TEAM),
			teamName: clampOr(teamNames.get(teamId), 120, UNNAMED_TEAM),
			avatar: marks.get(teamId) ?? null,
			assignedStages,
			channels: talentRooms
				.filter((room) => room.stage_id !== null && held.has(room.stage_id))
				.map((room) => toProjectChannel(room, "team", stageNames.get(room.stage_id ?? "") ?? null)),
		});
	}

	return out;
}

// #endregion

// #region Queries

/**
 * The `projects.projects` columns the summary does not carry.
 *
 * A secondary read of a row {@link fetchProjectBySlug} has already resolved, so it degrades rather
 * than throws: an empty description and a null client make the sidebar less informative, while a
 * throw would take down a page whose identity is already in hand.
 *
 * The route segment is opaque, so it takes the same shape branch every sibling resolver takes. A bare
 * `.eq("slug", …)` degrades in the worst possible way here: a uuid segment satisfies the slug CHECK,
 * so the read matches nothing, returns `null` without an error, and the sidebar silently renders an
 * engagement with no description and no client rather than reporting anything at all.
 */
async function fetchDetailRow(db: SupabaseClient, projectKey: string): Promise<DetailRow | null> {
	const { data, error } = await db
		.from("projects")
		.select("owner_user_id, description_text, client_business_id, structure_variation")
		.eq("slug", projectKey)
		.maybeSingle();
	if (error || !data) return null;
	return data as unknown as DetailRow;
}

/**
 * Every stage of the engagement, in pipeline order.
 *
 * Throws: the stage list is the projection's substance, not an annotation on it — see the module
 * docblock's failure split.
 */
async function fetchStages(db: SupabaseClient, projectId: string): Promise<StageRow[]> {
	const { data, error } = await db
		.from("project_stages")
		.select("id, slug, name, sort_order, status")
		.eq("project_id", projectId)
		.order("sort_order", { ascending: true });
	if (error) throw new Error(`projects.project_stages read failed: ${error.message}`);
	return (data ?? []) as unknown as StageRow[];
}

/**
 * The engagement's participant rows.
 *
 * Degrades to empty: the SELECT policy is owner-or-(active AND public), so an empty result is the
 * ORDINARY outcome for a hired freelancer on a private project rather than a fault, and a failure is
 * indistinguishable from it at the roster. The owner is added to the roster separately, so a viewer
 * who reads nothing here still sees a member list with somebody in it.
 */
async function fetchParticipants(db: SupabaseClient, projectId: string): Promise<ParticipantRow[]> {
	const { data, error } = await db
		.from("project_participants")
		.select("id, profile_type, profile_id, role")
		.eq("project_id", projectId)
		.order("created_at", { ascending: true });
	if (error) return [];
	return (data ?? []) as unknown as ParticipantRow[];
}

/**
 * Every channel of the project this viewer may enter, oldest first.
 *
 * No visibility predicate and no access predicate: `comms.has_channel_access` is already the SELECT
 * policy, so what arrives IS the viewer's reachable set. Adding a client-side filter would be a
 * second, weaker copy of a rule the database enforces — and the copy is the one that drifts.
 *
 * Ordered ascending because creation order is meaningful in this table: the General room is
 * provisioned first, and a stage's three rooms are inserted in the order `comms.get_stage_channels`
 * iterates them.
 *
 * Throws: an engagement rendered with no channels is a claim about the engagement.
 */
async function fetchChannels(
	actor: ReadActor & { accessToken: string },
	projectId: string,
): Promise<ChannelRow[]> {
	const { data, error } = await commsDb(actor)
		.from("project_channels")
		.select("id, name, stage_id, visibility, created_at")
		.eq("project_id", projectId)
		.order("created_at", { ascending: true });
	if (error) throw new Error(`comms.project_channels read failed: ${error.message}`);
	return (data ?? []) as unknown as ChannelRow[];
}

/**
 * The hired teams the viewer is an active member of: team id → the stages it holds, in pipeline order.
 *
 * Degrades to empty, which omits the Teams group — a read that failed has not shown the viewer to be
 * on a hired team, and an empty group would claim a relationship nobody established.
 */
async function fetchViewerHiredTeams(
	db: SupabaseClient,
	projectId: string,
): Promise<Map<string, string[]>> {
	const byTeam = new Map<string, string[]>();
	const { data, error } = await db.rpc("get_viewer_hired_teams", { p_project_id: projectId });
	if (error) return byTeam;

	for (const row of (data ?? []) as HiredTeamRow[]) {
		if (!row.team_id || !row.project_stage_id) continue;
		const stages = byTeam.get(row.team_id) ?? [];
		if (!stages.includes(row.project_stage_id)) stages.push(row.project_stage_id);
		byTeam.set(row.team_id, stages);
	}
	return byTeam;
}

/** `org.teams` rows for a set of ids. Degrades to empty — the caller falls back to a generic label. */
async function fetchTeams(
	actor: ReadActor & { accessToken: string },
	teamIds: readonly string[],
): Promise<Map<string, TeamRow>> {
	const out = new Map<string, TeamRow>();
	const unique = [...new Set(teamIds)];
	if (unique.length === 0) return out;

	const { data, error } = await orgDb(actor)
		.from("teams")
		.select("id, name, avatar_file_id")
		.in("id", unique);
	if (error) return out;
	for (
		const row of (data ?? []) as { id: string; name: string | null; avatar_file_id: string | null }[]
	) {
		out.set(row.id, { name: row.name?.trim() ?? "", avatarFileId: row.avatar_file_id });
	}
	return out;
}

/**
 * Entity id → public mark URL for the teams and businesses on this engagement, in ONE
 * `files.get_public_media` round trip. A mark that is not public, or not there, is simply absent —
 * the group then draws its initials. Never throws: a failed lookup costs pictures, not the sidebar.
 */
async function fetchMarks(
	actor: ReadActor & { accessToken: string },
	teams: ReadonlyMap<string, TeamRow>,
	businesses: ReadonlyMap<string, BusinessRow>,
): Promise<Map<string, string>> {
	const byFile = new Map<string, string[]>();
	const note = (entityId: string, fileId: string | null) => {
		if (!fileId) return;
		const list = byFile.get(fileId) ?? [];
		list.push(entityId);
		byFile.set(fileId, list);
	};
	for (const [id, row] of teams) note(id, row.avatarFileId);
	for (const [id, row] of businesses) note(id, row.logoFileId);

	const marks = new Map<string, string>();
	if (byFile.size === 0) return marks;
	const media = await fetchPublicMedia(getUserClient(actor.accessToken), [...byFile.keys()]);
	for (const [fileId, ref] of media) {
		const url = mediaUrl(ref, "sm");
		if (!url || url.length > MARK_URL_MAX) continue;
		for (const entityId of byFile.get(fileId) ?? []) marks.set(entityId, url);
	}
	return marks;
}

/**
 * `org.business_profiles` rows for a set of ids — the client party and any business-seat participant.
 *
 * `slug` doubles as the handle: businesses resolve in the same wildcard `@handle` namespace as people
 * and teams, so it is the addressable identity rather than a decorative string. Degrades to empty.
 */
async function fetchBusinesses(
	actor: ReadActor & { accessToken: string },
	businessIds: readonly string[],
): Promise<Map<string, BusinessRow>> {
	const out = new Map<string, BusinessRow>();
	const unique = [...new Set(businessIds.filter((id) => id.length > 0))];
	if (unique.length === 0) return out;

	const { data, error } = await orgDb(actor)
		.from("business_profiles")
		.select("id, name, slug, logo_file_id")
		.in("id", unique);
	if (error) return out;
	for (
		const row of (data ?? []) as {
			id: string;
			name: string | null;
			slug: string | null;
			logo_file_id: string | null;
		}[]
	) {
		out.set(row.id, {
			name: row.name?.trim() ?? "",
			slug: row.slug?.trim() ?? "",
			logoFileId: row.logo_file_id,
		});
	}
	return out;
}

// #endregion

// #region Assembly

/**
 * The client side of the engagement, or `null`.
 *
 * A business rather than a person, which `ProjectPartySchema` carries perfectly well — it is a name, a
 * mark and a handle, and a business has all three. The handle is `org.business_profiles.slug` because
 * businesses resolve in the same wildcard `@handle` namespace as people and teams; a business whose
 * row could not be read yields `null` rather than a placeholder, since "we could not read the client"
 * and "there is no client" render the same and only one of them is worth asserting.
 */
function clientPartyOf(
	clientBusinessId: string | null,
	businesses: ReadonlyMap<string, BusinessRow>,
	marks: ReadonlyMap<string, string>,
): ProjectParty | null {
	if (!clientBusinessId) return null;
	const row = businesses.get(clientBusinessId);
	if (!row || !row.name) return null;
	return {
		name: clampOr(row.name, 120, UNNAMED_CLIENT),
		avatar: marks.get(clientBusinessId) ?? null,
		handle: row.slug ? clamp(row.slug, 40) : null,
	};
}

/**
 * The roster: the owner, then every participant.
 *
 * The owner leads and is taken from the SUMMARY's already-resolved party rather than looked up again,
 * so the name on the roster and the name on the header card cannot disagree. Seats are then
 * deduplicated by identity — an owner who also holds a participant row appears once, under the owner
 * seat, because `owner` outranks anything the free-text `role` column could say.
 *
 * `id` is the participant row's own uuid, and the owner's is their user id: both are real keys, and
 * the field is only ever a render key, never a route segment.
 */
function buildMembers(
	summary: ProjectSummary,
	ownerUserId: string,
	participants: readonly ParticipantRow[],
	parties: ReadonlyMap<string, PartyRow>,
	businesses: ReadonlyMap<string, BusinessRow>,
	marks: ReadonlyMap<string, string>,
): ProjectMember[] {
	const out: ProjectMember[] = [];
	const seen = new Set<string>();

	if (ownerUserId) {
		out.push({ id: clamp(ownerUserId, 80), party: summary.owner, role: "owner" });
		seen.add(ownerUserId);
	}

	for (const row of participants) {
		if (seen.has(row.profile_id)) continue;
		seen.add(row.profile_id);

		let party: ProjectParty;
		if (row.profile_type === "business") {
			const business = businesses.get(row.profile_id);
			party = {
				// "Unknown" for the same reason `partyOf` uses it: the name is `min(1)`, so a withheld
				// row has to be spelled rather than passed through as empty.
				name: clampOr(business?.name, 120, "Unknown"),
				avatar: marks.get(row.profile_id) ?? null,
				handle: business?.slug ? clamp(business.slug, 40) : null,
			};
		} else {
			party = partyOf(parties.get(row.profile_id));
		}

		out.push({
			id: clampOr(row.id, 80, row.profile_id),
			party,
			role: toMemberViewerRole(row.role),
		});
	}

	return out;
}

// #endregion

// #region Public read

/**
 * The deep single-engagement projection for one slug, or `null` when there is no such engagement.
 *
 * `null` covers both "no row with this slug" and "a row RLS will not show this viewer" — the two are
 * indistinguishable from here by design, since telling them apart would confirm the existence of a
 * project the caller may not see.
 *
 * ## Fields with no column, returned neutral rather than invented
 *
 * - **`channels.dms` is always empty.** A DM channel's `chatId` is the unified thread id the global
 *   inbox opens, and the sidebar routes a DM row by that value. There is no `chatId` column anywhere,
 *   and `comms.dm_threads.id` is a v4 uuid — so the fixtures' `dm-{handle}` convention cannot be
 *   reproduced, and a synthesised id would not round-trip to any primary key. Nothing writes
 *   `comms.dm_messages.project_id` either, and the project chat route reads project rooms only — so
 *   the Private Messages group is simply not drawn on this path, rather than drawn with dead links.
 * - **`bannerImage` is always `null`.** No banner column exists on `projects.projects`, and the
 *   service blueprint that would carry one lives in `marketplace`, which PostgREST does not expose.
 * - **`starred` is always `false`**, inherited from the summary: there is no `project_stars` table.
 * - **Every channel's `unread` is `false`** — there is no per-viewer read watermark for a project
 *   channel; see `NO_UNREAD_SIGNAL`.
 * - **Avatars are resolved, never composed** — a person's through `org.get_party_cards`, a team's or
 *   a business's through `files.get_public_media`; an entity without a public mark stays `null`.
 *
 * ## Two fields whose live meaning differs from the fixtures', stated rather than smoothed over
 *
 * - **`owner`** is the party behind `projects.projects.owner_user_id`, which the summary already
 *   resolves. The schema calls that field the provider side; the column is the seat that CREATED the
 *   engagement, and for a service instantiated by a buyer those are opposite sides. This module
 *   inherits the summary's answer rather than introducing a second, disagreeing one — the divergence
 *   belongs to `toSummary`, and resolving it in two places would be how the two stop agreeing.
 * - **`client`** is the paying business (`client_business_id`), or `null`. It is not "the other side of
 *   the hire" in general: a project with an individual client has no row that names them apart from
 *   the owner, and naming the owner twice would assert a counterparty that does not exist.
 */
export async function fetchProjectDetail(
	actor: ReadActor & { accessToken: string },
	slug: string,
): Promise<ProjectDetail | null> {
	// The summary read is the gate: it throws for a genuine query failure and returns null for a slug
	// that resolves to nothing, which is exactly this function's contract. Everything below enriches a
	// project whose identity, scope and viewer role are already settled.
	const summary = await fetchProjectBySlug(actor, slug);
	if (!summary) return null;

	const db = projectsDb(actor);
	// Five independent reads over one project. Issued together because none depends on another's
	// result, and awaiting them in series would add all five latencies to every sidebar render.
	const [detailRow, stages, participants, channelRows, hired] = await Promise.all([
		fetchDetailRow(db, slug),
		fetchStages(db, summary.id),
		fetchParticipants(db, summary.id),
		fetchChannels(actor, summary.id),
		fetchViewerHiredTeams(db, summary.id),
	]);

	const { general, stageAll, privateRooms } = partitionChannels(channelRows);

	const stageNames = new Map<string, string>();
	stages.forEach((stage, index) => {
		stageNames.set(stage.id, clampOr(stage.name, 120, `Stage ${index + 1}`));
	});

	const clientBusinessId = detailRow?.client_business_id ?? null;

	const [teams, businesses, parties] = await Promise.all([
		fetchTeams(actor, [...hired.keys()]),
		fetchBusinesses(actor, [
			clientBusinessId ?? "",
			...participants.filter((row) => row.profile_type === "business").map((r) => r.profile_id),
		]),
		fetchParties(
			actor,
			participants.filter((row) => row.profile_type !== "business").map((r) => r.profile_id),
		),
	]);

	// A third wave, and only when a team or a business has a mark to resolve.
	const marks = await fetchMarks(actor, teams, businesses);

	const teamNames = new Map<string, string>();
	for (const [id, row] of teams) if (row.name) teamNames.set(id, row.name);

	const ownerUserId = detailRow?.owner_user_id ?? "";

	return {
		id: summary.id,
		slug: summary.slug,
		title: summary.title,
		kind: summary.kind,
		format: summary.format,
		structure: toProjectStructure(detailRow?.structure_variation),
		status: summary.status,
		typeLabel: typeLabelFor(summary),
		description: clamp(detailRow?.description_text, 2000),
		viewerRole: summary.viewerRole,
		viewerIsClient: resolveViewerIsClient(actor, ownerUserId, participants),
		scopeType: summary.scopeType,
		scopeLabel: summary.scopeLabel,
		starred: summary.starred,
		owner: summary.owner,
		client: clientPartyOf(clientBusinessId, businesses, marks),
		bannerImage: null,
		members: buildMembers(summary, ownerUserId, participants, parties, businesses, marks),
		channels: {
			general: general.map((row) => toProjectChannel(row, "general", null)),
			stages: buildStageChannels(stages, stageAll),
			teams: buildTeamChannels(hired, privateRooms, stageNames, teamNames, marks),
			// See the docblock: a DM thread has no reproducible unified id on the live path.
			dms: [],
		},
	};
}

// #endregion
