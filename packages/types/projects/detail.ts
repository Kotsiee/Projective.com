import { z } from "zod";
import { ContextType } from "../auth/mod.ts";
import {
	EngagementKind,
	ProjectFormat,
	ProjectPartySchema,
	ProjectStatus,
	ProjectViewerRole,
} from "./summary.ts";
import { isTaskProject, ProjectStructure } from "./setup.ts";
import { ProjectAccess } from "./access.ts";

/**
 * projects.detail — the Zod SSOT for the RICH single-engagement projection the Project Details
 * sidebar (`/projects/[projectId]`) renders. Where {@link ProjectSummarySchema} is the compact feed
 * row, this is the deep, one-engagement read: the contextual header card (Project vs Service),
 * the core view links, the four-group communication channel tree (General · Stages · Teams · DMs),
 * and the viewer capability flags that gate client-only actions.
 *
 * It stays a read projection, not a table row — it flattens the parts of `projects.projects`,
 * `projects.project_stages`, `projects.channels`, `projects.project_participants`, and the assigned
 * `org.team_members` a single deep view needs. Only enum/array/string/number/boolean primitives are
 * used so the schema is stable across Zod majors (matching {@link ProjectSummarySchema}). The richer
 * full-row schemas land alongside their own reads later (root CLAUDE.md §1).
 */

// #region Primitives
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(UUID_RE, "Expected a UUID.");
// #endregion

// #region Channels
/** Which of the four tree groups a channel belongs to (drives its icon + grouping). */
export const ChannelKind = z.enum(["general", "stage", "team", "dm"]);
export type ChannelKind = z.infer<typeof ChannelKind>;

/**
 * One conversation surface inside a project. `chatId` is the **unified** thread id shared with the
 * global messages page (`/messages/[chatId]`) — a project DM or team channel points at the SAME
 * underlying thread as the corresponding global DM, so history is one continuous record regardless of
 * where it is opened (PRODUCT_SPEC §Unified Messaging). Rendering a thread inside a project passes a
 * `currentProjectId` so messages authored in this context can be visually distinguished and filtered.
 */
export const ProjectChannelSchema = z.object({
	/** Stable channel id within the project (the tree key). */
	id: z.string().min(1).max(80),
	/** The unified thread id — shared with the global DM/thread of the same conversation. */
	chatId: z.string().min(1).max(80),
	name: z.string().min(1).max(120),
	kind: ChannelKind,
	/** A short clarifying sub-label (e.g. the stage a team channel is assigned to). */
	sublabel: z.string().max(120).nullable().optional(),
	/** Unseen activity — a pulsing dot, never a count (DESIGN_SYSTEM.md Part D). */
	unread: z.boolean(),
});
export type ProjectChannel = z.infer<typeof ProjectChannelSchema>;

/**
 * The single actionable signal on a stage channel — rendered as a tiny icon-only status glyph beside
 * the stage name (label revealed on hover via Tooltip; never inline text), mirroring the feed card's
 * {@link ProjectActivity} idiom. `null`/absent = nothing awaiting the viewer on this stage.
 *
 * - `new_ticket` — a new ticket is open on this stage.
 * - `revision_requested` — the client asked for a revision on this stage's submission.
 * - `stage_invite` — the client has requested the viewer join this (additional) stage.
 */
export const StageActivity = z.enum(["new_ticket", "revision_requested", "stage_invite"]);
export type StageActivity = z.infer<typeof StageActivity>;

/** One stage of the engagement, with its stage-scoped channel. */
export const StageChannelSchema = z.object({
	id: z.string().min(1).max(80),
	/**
	 * The stage's PUBLIC ADDRESS — the `stg-…` route slug, and the only one of this object's three
	 * identifiers that appears in a URL.
	 *
	 * A stage row carries three keys that are easy to mistake for one another, so they are named for
	 * what they are FOR rather than for what they hold: {@link StageChannelSchema.id} is the room the
	 * tree opens, `stageId` is the configuration row behind it, and this is what a link points at.
	 *
	 * Routing on the slug rather than on `id` is what makes a stage link survivable. `id` is a
	 * `comms.project_channels` uuid on the live path, and that room is provisioned LAZILY on first
	 * open — so a link built from it could not be minted before somebody had already visited, and said
	 * nothing about what it addressed once it was. The slug is minted with the stage itself, is
	 * refused by `security.fn_slug_guard` on any later update, and its prefix identifies the row's
	 * table from the bare segment.
	 */
	slug: z.string().min(1).max(80),
	/**
	 * The `projects.project_stages` row this channel belongs to — NOT the same string as `id`.
	 *
	 * `id` is the routed channel segment, and on the live path it is a `comms.project_channels` id
	 * because that is what the tree navigates to. The stage's own id is a different key in a different
	 * schema, and the setup projection (`StageSetup.id`) is keyed on THAT one. Without this field a
	 * surface routed to `/projects/{project}/{channel}/…` has no way back to the stage's
	 * configuration: the mapping exists only inside `buildStageChannels`, which holds both and
	 * projected neither.
	 *
	 * The fixtures make the two strings equal, which is exactly why this could not be discovered by
	 * using the stub — a lookup written against `id` works there and finds nothing in production.
	 */
	stageId: z.string().min(1).max(80),
	name: z.string().min(1).max(120),
	/** Display order (0-based). */
	order: z.number().int().min(0),
	status: ProjectStatus,
	/** The single icon-only status signal on this stage (see {@link StageActivity}). */
	activity: StageActivity.nullable().optional(),
	channel: ProjectChannelSchema,
});
export type StageChannel = z.infer<typeof StageChannelSchema>;

/**
 * A HIRED team the viewer is an active member of WITHIN this project — never a team they are merely
 * invited to, and never the client side's own rooms. A viewer can belong to more than one hired team,
 * and a team can hold more than one stage — so the group carries the assigned-stage labels and one
 * channel per provisioned talent room (each channel's `sublabel` names its stage). `channels` may be
 * empty: the membership is the fact, and a room nobody has opened yet is not the read's to invent.
 */
export const TeamChannelSchema = z.object({
	teamId: z.string().min(1).max(80),
	teamName: z.string().min(1).max(120),
	/** Team mark (Unsplash face crop / null → initials fallback). */
	avatar: z.string().max(400).nullable(),
	/** Human labels of the stages this team is assigned to (may be several). */
	assignedStages: z.array(z.string().max(120)),
	channels: z.array(ProjectChannelSchema),
});
export type TeamChannel = z.infer<typeof TeamChannelSchema>;

/**
 * A direct-message thread with another party in the engagement. `chatId` is the unified global DM id,
 * so opening it here or from `/messages` shows the same history. `hasProjectContext` marks a DM that
 * already carries messages sent inside this project — only those appear in the project's Private
 * Messages group (see {@link conditionalChannelGroups}).
 */
export const DmChannelSchema = z.object({
	chatId: z.string().min(1).max(80),
	party: ProjectPartySchema,
	unread: z.boolean(),
	hasProjectContext: z.boolean(),
});
export type DmChannel = z.infer<typeof DmChannelSchema>;

/**
 * The stage a routed segment addresses, or `null` when the segment names no stage.
 *
 * The ONE implementation of "which stage is this URL talking about", called by the channel resolver,
 * the board, the submissions tree, the calendar and the stage Details route alike. It was four
 * separate `find` calls before, and they had already drifted: two matched the stage's own id, one
 * matched the channel's, one matched both plus a `stage-{id}` string. Every one of them type-checks
 * against any of the three keys, because all three are `string`.
 *
 * Matches the SLUG and nothing else. A stage's id and its channel's id are internal keys that never
 * appear in a path, and accepting them here would let an address resolve in the stub — where the
 * fixtures make those strings coincide — and 404 in production, where they do not.
 *
 * The one other address it answers is {@link DISCUSSION_REF}, and only for a Task (`opts.task`): a
 * Task's discussion IS its one stage's room, so `/projects/{slug}/discussion/tasks` names that stage
 * exactly as its `stg-…` address does. On any other engagement the discussion is the project-wide
 * room, which is not a stage, so the word resolves to nothing here.
 */
export function findStageChannel(
	stages: readonly StageChannel[],
	ref: string | null | undefined,
	opts: { task?: boolean } = {},
): StageChannel | null {
	if (!ref) return null;
	const bySlug = stages.find((s) => s.slug === ref);
	if (bySlug) return bySlug;
	return opts.task && isDiscussionRef(ref) ? rootStageOf(stages, (s) => s.order) : null;
}

/** The four communication-tree groups, pre-partitioned server-side. */
export const ProjectChannelsSchema = z.object({
	general: z.array(ProjectChannelSchema),
	stages: z.array(StageChannelSchema),
	teams: z.array(TeamChannelSchema),
	dms: z.array(DmChannelSchema),
});
export type ProjectChannels = z.infer<typeof ProjectChannelsSchema>;

/** The two channel-tree groups that exist only when the viewer has something in them. */
export interface ConditionalChannelGroups {
	/** Hired teams the viewer is an active member of — each holding at least one stage. */
	teams: TeamChannel[];
	/** Threads with project members that carry messages sent inside this project. */
	dms: DmChannel[];
}

/**
 * The rows the Teams and Private Messages groups would draw. An EMPTY list means the group is not
 * rendered at all — no header and no empty note — because an empty "Teams" group asserts a
 * relationship to the project that the viewer does not have.
 *
 * Membership is decided by the server (see {@link TeamChannelSchema}); this only drops a team that
 * holds no stage, which is not a hire. A thread without `hasProjectContext` belongs to the global
 * inbox, not to this engagement's lane. Every lane that draws either group reads this, so the channel
 * tree and the group-session tree cannot disagree about when a group exists.
 */
export function conditionalChannelGroups(
	channels: Pick<ProjectChannels, "teams" | "dms">,
): ConditionalChannelGroups {
	return {
		teams: channels.teams.filter((team) => team.assignedStages.length > 0),
		dms: channels.dms.filter((dm) => dm.hasProjectContext),
	};
}
// #endregion

// #region Members
/** One participant of the engagement (the Members view). */
export const ProjectMemberSchema = z.object({
	id: z.string().min(1).max(80),
	party: ProjectPartySchema,
	role: ProjectViewerRole,
});
export type ProjectMember = z.infer<typeof ProjectMemberSchema>;
// #endregion

// #region Detail projection
/** The full single-engagement read behind the Project Details sidebar. */
export const ProjectDetailSchema = z.object({
	id: uuid,
	slug: z.string().min(1).max(120),
	title: z.string().min(1).max(160),
	kind: EngagementKind,
	format: ProjectFormat,
	/**
	 * `projects.structure_variation` — the second axis of the engagement's type.
	 *
	 * Carried because `format` alone cannot tell a Task from a milestone one-off: both are `one_off`,
	 * and they render different lanes, view links and channel tabs (`isTaskProject`).
	 */
	structure: ProjectStructure,
	status: ProjectStatus,
	/** Human type badge (e.g. "Brand Identity", "Web App"). */
	typeLabel: z.string().min(1).max(60),
	/** Full engagement description — the sidebar truncates to 2 lines with a "Show details" reveal. */
	description: z.string().max(2000),
	/** The acting user's role in THIS engagement. */
	viewerRole: ProjectViewerRole,
	/**
	 * Whether the acting user is the client/creator of the engagement — gates client-only actions
	 * (e.g. the inline "Create New Stage" affordance on the Stages group). Re-derived server-side from
	 * the viewer's role; never trusted from the client (root CLAUDE.md §6).
	 */
	viewerIsClient: z.boolean(),
	/**
	 * Whether the acting user holds review authority — `projects.can_review_project`: the owner, or an
	 * active member of the paying client business. Gates the engagement's configuration (`/details`,
	 * `/preview`) and the lane's Edit project control. Re-derived server-side, never trusted.
	 */
	viewerCanConfigure: z.boolean(),
	/**
	 * How the acting user stands toward the engagement — owner, participant or prospect — and so what
	 * its root address does for them (Decision #144, {@link landingFor}). Derived server-side beside
	 * {@link viewerIsClient}: `viewerRole` cannot answer it, because a stranger on a public engagement
	 * falls back to `member`, the same value a hire carries.
	 */
	viewerAccess: ProjectAccess,
	scopeType: ContextType,
	scopeLabel: z.string().min(1).max(120),
	/** Whether the actor starred this engagement (drives the header Star toggle). */
	starred: z.boolean(),
	/** The engagement owner (provider side). Shown as the primary identity on a **project** card. */
	owner: ProjectPartySchema,
	/** The client side. Shown as the identity on a **service** card; null for internal drafts. */
	client: ProjectPartySchema.nullable(),
	/** A service's banner/thumbnail image, shown atop the service card; null for projects. */
	bannerImage: z.string().max(400).nullable(),
	members: z.array(ProjectMemberSchema),
	channels: ProjectChannelsSchema,
});
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>;
// #endregion

// #region Discussion — the engagement's one primary conversation
/**
 * The reserved channel segment for an engagement's discussion: `/projects/{slug}/discussion`.
 *
 * The polymorphic channel segment's FIFTH self-describing form, beside a `stg-…` stage address, a
 * room uuid, a fixture channel id and a DM's `dm-…` chat id. It is a word rather than an id because
 * the room it names differs by archetype and must not leak into the URL:
 *
 *   - a **Task** (`isTaskProject`) talks in its one stage's shared room — the room `create_project`
 *     provisions for the implicit stage, and the one carrying the Tasks and Submissions views;
 *   - every **staged** engagement (one-off, pipeline, session) talks in its project-wide room
 *     (`comms.project_channels.visibility = 'project_all'`, no `stage_id`).
 *
 * A Task converted into a pipeline in settings changes which room the word opens and keeps its
 * address, which is exactly why the address is not either room's own key. It cannot collide with a
 * real channel: a stage segment is a `stg-…` slug, a room id is a uuid, and DMs are `dm-…`.
 */
export const DISCUSSION_REF = "discussion";

/** Whether a routed channel segment is {@link DISCUSSION_REF}. */
export function isDiscussionRef(ref: string | null | undefined): boolean {
	return ref === DISCUSSION_REF;
}

/**
 * An engagement's ROOT stage — the lowest `order`, ties left to array position.
 *
 * Generic over the row shape because the live reads hold `sort_order` rows and the projection holds
 * `order`, and the rule has to be one rule for both: a legacy Task that somehow holds two stages is
 * then answered deterministically everywhere rather than by whichever array each read happened to get.
 */
export function rootStageOf<T>(stages: readonly T[], orderOf: (stage: T) => number): T | null {
	let root: T | null = null;
	for (const stage of stages) {
		if (root === null || orderOf(stage) < orderOf(root)) root = stage;
	}
	return root;
}

/** The room an engagement's discussion lives in — a stage's (a Task) or the project-wide one. */
export type DiscussionRoom =
	| { kind: "stage"; stage: StageChannel }
	| { kind: "general"; channel: ProjectChannel };

/**
 * The room {@link DISCUSSION_REF} opens, or `null` when the engagement has none a link can reach.
 *
 * A Task takes its root stage's room, else a general room for an engagement whose stage room was
 * never provisioned (Decision #121). Everything else takes its project-wide room — the FIRST general
 * channel, which on the live path is the only one, because `comms.get_or_create_project_channel`
 * dedupes `project_all` per project. A staged engagement never falls back to a stage: its discussion
 * is the whole engagement's conversation, and quietly opening stage one instead would put the whole
 * team's chatter in a room some of them cannot see.
 *
 * `null` is a real answer — a lane offering a Discussion link that led nowhere would be a control that
 * renders and reaches nothing (root CLAUDE.md §3 gate 11).
 */
export function discussionRoomOf(
	channels: Pick<ProjectChannels, "general" | "stages">,
	task: boolean,
): DiscussionRoom | null {
	if (task) {
		const stage = rootStageOf(channels.stages, (s) => s.order);
		if (stage) return { kind: "stage", stage };
	}
	const general = channels.general[0];
	return general ? { kind: "general", channel: general } : null;
}

/**
 * {@link discussionRoomOf} for a whole engagement — the Task test folded in, so a caller holding a
 * {@link ProjectDetail} cannot pass the wrong archetype.
 */
export function discussionOf(
	detail: Pick<ProjectDetail, "format" | "structure" | "channels">,
): DiscussionRoom | null {
	return discussionRoomOf(detail.channels, isTaskProject(detail.format, detail.structure));
}

/**
 * Whether an engagement presents exactly ONE shared room — its Discussion — on every surface: a Task
 * or a Session. Presentation only: the stored rooms are untouched (a Task keeps its spare project-wide
 * room for a later switch to a pipeline, Decision #135), they are simply never listed.
 */
export function isSingleRoomEngagement(
	detail: Pick<ProjectDetail, "format" | "structure">,
): boolean {
	return detail.format === "session" || isTaskProject(detail.format, detail.structure);
}

/** The channel id behind a {@link DiscussionRoom}, or `null` when there is no room. */
export function discussionRoomId(room: DiscussionRoom | null): string | null {
	if (!room) return null;
	return room.kind === "stage" ? room.stage.channel.id : room.channel.id;
}

/** The name a single-room engagement gives its one room, whatever the stored row is called. */
export const SINGLE_ROOM_NAME = "Discussion";

/**
 * The room-specific segment a channel ref stands for: {@link DISCUSSION_REF} expanded to its room's
 * own address (a Task's stage slug, else the project-wide room's id), and every other ref unchanged.
 *
 * For the reads that match a segment against a projection's own keys — the fixture corpus, chiefly —
 * so `discussion` reaches the same rows its room's own address does. A discussion with no room comes
 * back unchanged and therefore matches nothing, which is the miss it is.
 */
export function expandChannelRef(
	detail: Pick<ProjectDetail, "format" | "structure" | "channels">,
	ref: string,
): string {
	if (!isDiscussionRef(ref)) return ref;
	const room = discussionOf(detail);
	if (!room) return ref;
	return room.kind === "stage" ? room.stage.slug : room.channel.id;
}

/**
 * Whether a segment OTHER than {@link DISCUSSION_REF} addresses the discussion room — the old URL of
 * a room that now has a canonical one. A Task's stage is reachable by its `stg-…` slug and by its
 * room's id; a staged engagement's project-wide room by its own id. The caller redirects such an
 * address to `/discussion`, so a link minted before the word existed lands where the lane points.
 */
export function addressesDiscussion(
	detail: Pick<ProjectDetail, "format" | "structure" | "channels">,
	ref: string,
): boolean {
	if (isDiscussionRef(ref)) return false;
	const room = discussionOf(detail);
	if (!room) return false;
	return room.kind === "stage"
		? ref === room.stage.slug || ref === room.stage.id
		: ref === room.channel.id;
}
// #endregion
