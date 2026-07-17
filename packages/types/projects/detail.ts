import { z } from "zod";
import { ContextType } from "../auth/mod.ts";
import {
	EngagementKind,
	ProjectFormat,
	ProjectPartySchema,
	ProjectStatus,
	ProjectViewerRole,
} from "./summary.ts";

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
 * A team the viewer belongs to WITHIN this project. A viewer can belong to more than one assigned
 * team, and a team can be assigned to more than one stage — so the group carries the assigned-stage
 * labels and one channel per assignment (each channel's `sublabel` names its stage).
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
 * already carries messages authored inside this project (drives the project accent tag + enables the
 * "This project only" filter).
 */
export const DmChannelSchema = z.object({
	chatId: z.string().min(1).max(80),
	party: ProjectPartySchema,
	unread: z.boolean(),
	hasProjectContext: z.boolean(),
});
export type DmChannel = z.infer<typeof DmChannelSchema>;

/** The four communication-tree groups, pre-partitioned server-side. */
export const ProjectChannelsSchema = z.object({
	general: z.array(ProjectChannelSchema),
	stages: z.array(StageChannelSchema),
	teams: z.array(TeamChannelSchema),
	dms: z.array(DmChannelSchema),
});
export type ProjectChannels = z.infer<typeof ProjectChannelsSchema>;
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
