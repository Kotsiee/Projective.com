import type { SupabaseClient } from "supabaseClient";
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
 * freelancer on a private engagement therefore reads an EMPTY roster and empty assignments — not an
 * error, just nothing — so the members list degrades to the owner alone and team groups lose their
 * names. That is the same missing-policy gap the feed read records in
 * `documentation/architecture/READ_API_FINDINGS.md`, seen from a second angle.
 */

// #region Row shapes

/** The `projects.projects` columns this projection needs BEYOND the ones the summary already carries. */
interface DetailRow {
	owner_user_id: string;
	description_text: string | null;
	client_business_id: string | null;
}

/** One `projects.project_stages` row, reduced to what the stage tree renders. */
interface StageRow {
	id: string;
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
 * One `projects.stage_assignments` row.
 *
 * The only evidence anywhere of WHICH team a `team_private` stage room belongs to:
 * `comms.project_channels` has a `stage_id` and a `visibility` and no team column at all, so a talent
 * room can only be attributed to a team by asking which team holds the stage.
 */
interface AssignmentRow {
	project_stage_id: string;
	assignee_type: string;
	team_id: string | null;
	status: string;
}

/** A resolved `org.business_profiles` row — the two columns a party projection needs. */
interface BusinessRow {
	name: string;
	slug: string;
}

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
 * `projects.stage_assignments.status` values that mean the assignment is no longer live.
 *
 * The column is free text with no CHECK; this set mirrors the exclusion list `comms.can_access_scope`
 * and `projects.has_stage_access` both spell out, so an assignment that no longer grants access to a
 * talent room also no longer names the team that room belongs to.
 */
const DEAD_ASSIGNMENT: ReadonlySet<string> = new Set(["released", "cancelled", "declined"]);

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
	return !!own && CLIENT_SIDE_ROLES.has(own.role.trim().toLowerCase());
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
 * The Teams group: the private stage rooms, grouped by the party that owns them.
 *
 * ## Why client-side rooms are in here too
 *
 * The group's name says "Teams" and its schema field says `teamId`, but the tree has four groups and a
 * `business_private` room fits none of the other three: it is not project-wide (General), it is not a
 * stage's shared room (Stages), and it is not a person-to-person thread (DMs). The alternative to
 * widening this group is dropping those rooms, which would leave a client-side viewer with a room they
 * are allowed into and no way to reach it from the sidebar. So the group is read as "a private
 * sub-project room, grouped by the party that owns it" — the talent side's team, or the client side's
 * business — and both render identically: a name, a mark, the stages they cover, and their rooms.
 *
 * ## Grouping never depends on a lookup that may be withheld
 *
 * The groups are built from the CHANNELS, which RLS has already narrowed to what this viewer may
 * enter. `projects.stage_assignments` and the `org` name tables only ever supply the LABEL. So when
 * those reads come back empty — which they do for any non-owner on a private project, since the
 * assignment policy is owner-or-public — the rooms still appear, under {@link UNNAMED_TEAM} or
 * {@link UNNAMED_CLIENT}. Degrading a name costs specificity; degrading membership would cost the
 * reader a room.
 *
 * `avatar` is always `null`, for the same reason every party's is: `org.teams.avatar_file_id` and
 * `org.business_profiles.logo_file_id` are foreign keys into `files.items`, not URLs, and composing a
 * served path from one belongs to the files domain behind its own gate. A guessed path renders as a
 * broken image; a null renders as the initials the `Avatar` component already draws.
 */
function buildTeamChannels(
	privateRooms: readonly ChannelRow[],
	stageNames: ReadonlyMap<string, string>,
	teamByStage: ReadonlyMap<string, string>,
	teamNames: ReadonlyMap<string, string>,
	clientBusinessId: string | null,
	businessNames: ReadonlyMap<string, string>,
): TeamChannel[] {
	const groups = new Map<string, TeamChannel>();

	for (const room of privateRooms) {
		const stageId = room.stage_id ?? "";
		const stageName = stageNames.get(stageId) ?? null;

		let key: string;
		let label: string;
		if (room.visibility === VIS_BUSINESS_PRIVATE) {
			// The paying business owns every client-side room in the project, so one group covers them
			// all. Keyed on a literal when the project has no business — a personal client is still the
			// client side, and the owner reaches these rooms via `projects.can_review_project`.
			key = clientBusinessId ?? "client";
			label = (clientBusinessId ? businessNames.get(clientBusinessId) : null) ?? UNNAMED_CLIENT;
		} else {
			const teamId = teamByStage.get(stageId) ?? null;
			// A stage held by an individual freelancer rather than a team has a live talent room and no
			// team behind it, so those rooms collect under one unnamed group rather than vanishing.
			key = teamId ?? "team";
			label = (teamId ? teamNames.get(teamId) : null) ?? UNNAMED_TEAM;
		}

		let group = groups.get(key);
		if (!group) {
			group = {
				teamId: clampOr(key, 80, UNNAMED_TEAM),
				teamName: clampOr(label, 120, UNNAMED_TEAM),
				avatar: null,
				assignedStages: [],
				channels: [],
			};
			groups.set(key, group);
		}
		if (stageName && !group.assignedStages.includes(stageName)) {
			group.assignedStages.push(clamp(stageName, 120));
		}
		group.channels.push(toProjectChannel(room, "team", stageName));
	}

	return [...groups.values()];
}

// #endregion

// #region Queries

/**
 * The `projects.projects` columns the summary does not carry.
 *
 * A secondary read of a row {@link fetchProjectBySlug} has already resolved, so it degrades rather
 * than throws: an empty description and a null client make the sidebar less informative, while a
 * throw would take down a page whose identity is already in hand.
 */
async function fetchDetailRow(db: SupabaseClient, slug: string): Promise<DetailRow | null> {
	const { data, error } = await db
		.from("projects")
		.select("owner_user_id, description_text, client_business_id")
		.eq("slug", slug)
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
		.select("id, name, sort_order, status")
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
 * Which team holds each stage, for naming the talent-side rooms.
 *
 * Only live team assignments count — the exclusion list mirrors `comms.can_access_scope`, so a team
 * whose assignment was released no longer labels the room its former members can no longer open.
 * Degrades to empty; the rooms survive unnamed.
 */
async function fetchTeamByStage(
	db: SupabaseClient,
	stageIds: readonly string[],
): Promise<Map<string, string>> {
	const byStage = new Map<string, string>();
	if (stageIds.length === 0) return byStage;

	const { data, error } = await db
		.from("stage_assignments")
		.select("project_stage_id, assignee_type, team_id, status")
		.in("project_stage_id", stageIds as string[]);
	if (error) return byStage;

	for (const row of (data ?? []) as unknown as AssignmentRow[]) {
		if (row.assignee_type !== "team" || !row.team_id) continue;
		if (DEAD_ASSIGNMENT.has(row.status)) continue;
		// First live assignment wins. A stage re-assigned between teams keeps the room attributed to
		// whichever assignment is still open, and a duplicate is not a decision this read arbitrates.
		if (!byStage.has(row.project_stage_id)) byStage.set(row.project_stage_id, row.team_id);
	}
	return byStage;
}

/** Human names for a set of `org.teams` ids. Degrades to empty — the caller falls back to a generic label. */
async function fetchTeamNames(
	actor: ReadActor & { accessToken: string },
	teamIds: readonly string[],
): Promise<Map<string, string>> {
	const names = new Map<string, string>();
	const unique = [...new Set(teamIds)];
	if (unique.length === 0) return names;

	const { data, error } = await orgDb(actor).from("teams").select("id, name").in("id", unique);
	if (error) return names;
	for (const row of (data ?? []) as { id: string; name: string | null }[]) {
		if (row.name?.trim()) names.set(row.id, row.name.trim());
	}
	return names;
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
		.select("id, name, slug")
		.in("id", unique);
	if (error) return out;
	for (const row of (data ?? []) as { id: string; name: string | null; slug: string | null }[]) {
		out.set(row.id, { name: row.name?.trim() ?? "", slug: row.slug?.trim() ?? "" });
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
): ProjectParty | null {
	if (!clientBusinessId) return null;
	const row = businesses.get(clientBusinessId);
	if (!row || !row.name) return null;
	return {
		name: clampOr(row.name, 120, UNNAMED_CLIENT),
		avatar: null,
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
				avatar: null,
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
 *   reproduced, and a synthesised id would not round-trip to any primary key. An empty group is a
 *   group the reader can see is empty; a group of links that resolve to nothing is not.
 * - **`bannerImage` is always `null`.** No banner column exists on `projects.projects`, and the
 *   service blueprint that would carry one lives in `marketplace`, which PostgREST does not expose.
 * - **`starred` is always `false`**, inherited from the summary: there is no `project_stars` table.
 * - **Every channel's `unread` is `false`** — there is no per-viewer read watermark for a project
 *   channel; see `NO_UNREAD_SIGNAL`.
 * - **Every avatar is `null`** — the `org` avatar columns are file ids, not URLs.
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
	// Four independent reads over one project. Issued together because none depends on another's
	// result, and awaiting them in series would add all four latencies to every sidebar render.
	const [detailRow, stages, participants, channelRows] = await Promise.all([
		fetchDetailRow(db, slug),
		fetchStages(db, summary.id),
		fetchParticipants(db, summary.id),
		fetchChannels(actor, summary.id),
	]);

	const { general, stageAll, privateRooms } = partitionChannels(channelRows);

	const stageNames = new Map<string, string>();
	stages.forEach((stage, index) => {
		stageNames.set(stage.id, clampOr(stage.name, 120, `Stage ${index + 1}`));
	});

	const clientBusinessId = detailRow?.client_business_id ?? null;
	// A second wave rather than part of the first: the team names cannot be asked for until the
	// stage→team map exists, and that map needs the stage ids the first wave returned.
	const teamByStage = await fetchTeamByStage(db, stages.map((stage) => stage.id));

	const [teamNames, businesses, parties] = await Promise.all([
		fetchTeamNames(actor, [...teamByStage.values()]),
		fetchBusinesses(actor, [
			clientBusinessId ?? "",
			...participants.filter((row) => row.profile_type === "business").map((r) => r.profile_id),
		]),
		fetchParties(
			actor,
			participants.filter((row) => row.profile_type !== "business").map((r) => r.profile_id),
		),
	]);

	const businessNames = new Map<string, string>();
	for (const [id, row] of businesses) if (row.name) businessNames.set(id, row.name);

	const ownerUserId = detailRow?.owner_user_id ?? "";

	return {
		id: summary.id,
		slug: summary.slug,
		title: summary.title,
		kind: summary.kind,
		format: summary.format,
		status: summary.status,
		typeLabel: typeLabelFor(summary),
		description: clamp(detailRow?.description_text, 2000),
		viewerRole: summary.viewerRole,
		viewerIsClient: resolveViewerIsClient(actor, ownerUserId, participants),
		scopeType: summary.scopeType,
		scopeLabel: summary.scopeLabel,
		starred: summary.starred,
		owner: summary.owner,
		client: clientPartyOf(clientBusinessId, businesses),
		bannerImage: null,
		members: buildMembers(summary, ownerUserId, participants, parties, businesses),
		channels: {
			general: general.map((row) => toProjectChannel(row, "general", null)),
			stages: buildStageChannels(stages, stageAll),
			teams: buildTeamChannels(
				privateRooms,
				stageNames,
				teamByStage,
				teamNames,
				clientBusinessId,
				businessNames,
			),
			// See the docblock: a DM thread has no reproducible unified id on the live path.
			dms: [],
		},
	};
}

// #endregion
