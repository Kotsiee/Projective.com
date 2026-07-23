import { z } from "zod";
import { ProjectFormat, ProjectPartySchema } from "./summary.ts";
import { ChannelKind } from "./detail.ts";

/**
 * projects.members — the Zod SSOT for the Members roster read (`/projects/[projectId]/members` and the
 * channel-scoped `/projects/[projectId]/[channelId]/members`). Where {@link ProjectMemberSchema} in
 * `detail.ts` is the thin participant chip the sidebar shows, THIS is the deep management projection the
 * Members tab renders: each participant with their access role, stage assignment (contributor vs
 * observer), presence, assigned-stage / ticket summary, contact handle, and join date — plus the
 * pending-invitation queue and the viewer capability flags that gate the client/admin/manager actions.
 *
 * Like {@link ProjectDetailSchema} / {@link FileListPageSchema} this is a READ projection, not a table
 * row — the fat {@link ProjectBackendService} DERIVES it deterministically from the resolved
 * `ProjectDetail` while `PROJECTS_BACKEND_LIVE` is off (thin-frontend pattern, root CLAUDE.md §10); the
 * live path (RLS-scoped `projects.project_participants` + `org.*_members` + `projects.invitations`
 * reads) slots in behind the same gate with no shape churn. Only enum/array/string/number/boolean
 * primitives are used so the schema is stable across Zod majors (matching the sibling projects schemas).
 */

// #region Role & status
/**
 * The access role a participant holds in the engagement — the union the roster badges. `client`/`owner`
 * are the client authority tier; `admin`/`manager` are delegated oversight; `freelancer` is the hired
 * worker; `member` is any other team seat ("Team Member"); `guest` is a read-limited external observer.
 * A superset of {@link ProjectViewerRole} (which has no `manager`/`guest`) — the roster needs the finer
 * grain the management surface distinguishes.
 */
export const MemberRole = z.enum([
	"client",
	"owner",
	"admin",
	"manager",
	"freelancer",
	"member",
	"guest",
]);
export type MemberRole = z.infer<typeof MemberRole>;

/**
 * A participant's engagement WITH a specific stage/channel: an `contributor` is actively assigned to
 * deliver on it; an `observer` has visibility only. `null` on a non-stage channel or in project scope
 * (where the per-stage relationship is summarised by {@link ProjectMemberRow.assignedStages} instead).
 */
export const StageAssignment = z.enum(["contributor", "observer"]);
export type StageAssignment = z.infer<typeof StageAssignment>;

/** Coarse presence — a tonal dot beside the avatar (label revealed on hover, never inline text §B.6). */
export const MemberPresence = z.enum(["online", "away", "offline"]);
export type MemberPresence = z.infer<typeof MemberPresence>;

/** Whether the roster is scoped to one channel/stage or the whole project. */
export const MemberScope = z.enum(["channel", "project"]);
export type MemberScope = z.infer<typeof MemberScope>;

/** The lifecycle of a pending invitation. */
export const InviteStatus = z.enum(["pending", "expired"]);
export type InviteStatus = z.infer<typeof InviteStatus>;
// #endregion

// #region Member row
/** One participant row in the roster. */
export const ProjectMemberRowSchema = z.object({
	/** Stable participant id (the roster key + the actions-menu selector). */
	id: z.string().min(1).max(120),
	party: ProjectPartySchema,
	/** Contact email (derived from the handle in fixtures; the real column when live). */
	email: z.string().max(160),
	role: MemberRole,
	/**
	 * This participant's relationship to the routed stage/channel — `contributor` (assigned to deliver)
	 * or `observer` (visibility only). `null` for a non-stage channel row or a project-scope row.
	 */
	assignment: StageAssignment.nullable(),
	presence: MemberPresence,
	/** Human names of the stages this participant contributes to (the project-scope summary column). */
	assignedStages: z.array(z.string().max(120)),
	/** Open tickets assigned to this participant on the engagement — the roster's workload figure. */
	openTickets: z.number().int().min(0),
	/** Pre-formatted ticket summary ("3 open", "—") so SSR and the client render identically. */
	ticketsLabel: z.string().max(24),
	/** ISO join timestamp — the sortable "joined" key. */
	joinedAt: z.string(),
	/** Pre-formatted join date ("Jul 14, 2026") — UTC-derived so SSR == the client refetch. */
	joinedLabel: z.string().max(28),
	/** Whether this row is the acting viewer (a subtle "You" marker; never self-manageable). */
	isViewer: z.boolean(),
});
export type ProjectMemberRow = z.infer<typeof ProjectMemberRowSchema>;
// #endregion

// #region Pending invitation
/** One outstanding invitation in the Pending Invitations queue. */
export const MemberInviteSchema = z.object({
	id: z.string().min(1).max(120),
	/** The invited email address. */
	email: z.string().max(160),
	/** The role the invitee will hold once they accept. */
	role: MemberRole,
	/** The stage the invitee is being assigned to on acceptance, or null for a whole-project invite. */
	stageId: z.string().max(120).nullable(),
	stageName: z.string().max(120).nullable(),
	/** Display name of whoever sent the invite. */
	invitedBy: z.string().max(120),
	invitedAt: z.string(),
	/** Pre-formatted relative age ("2 days ago"). */
	invitedLabel: z.string().max(28),
	status: InviteStatus,
});
export type MemberInvite = z.infer<typeof MemberInviteSchema>;
// #endregion

// #region Supporting references
/** A stage reference for the stage filter + the invite/assign stage picker. */
export const MemberStageRefSchema = z.object({
	id: z.string().min(1).max(120),
	name: z.string().min(1).max(120),
});
export type MemberStageRef = z.infer<typeof MemberStageRefSchema>;

/**
 * The acting viewer's management capabilities on the roster, re-derived server-side from their role
 * (never trusted from the client, root CLAUDE.md §6). `canManage` is the master gate for the row
 * actions menu + the Invite affordance; the finer flags let the UI grey individual actions.
 */
export const MemberViewerCapsSchema = z.object({
	/** Master gate: can this viewer manage members at all (Client · Owner · Admin · Manager)? */
	canManage: z.boolean(),
	/** Can open the Invite modal + resend/cancel pending invitations. */
	canInvite: z.boolean(),
	/** Can assign/unassign participants to the current stage/channel. */
	canAssign: z.boolean(),
	/** Can change a participant's role. */
	canEditRoles: z.boolean(),
	/** Can revoke a participant's access. */
	canRemove: z.boolean(),
});
export type MemberViewerCaps = z.infer<typeof MemberViewerCapsSchema>;
// #endregion

// #region Request params
/**
 * The roster query. `channelId` unset/null selects the whole project (project scope). The `sim*` fields
 * are DEV-ONLY simulation hints the Dev Tools Context Switcher passes so the members surface can be
 * exercised from every role/project-type/invite-state angle — the live path ignores them (the real
 * viewer role + engagement format + invitation table are authoritative).
 */
export const MemberRosterParamsSchema = z.object({
	projectId: z.string().min(1).max(120),
	channelId: z.string().min(1).max(120).nullable().optional(),
	/** DEV-ONLY. Simulate the acting viewer's role/assignment (drives {@link MemberViewerCaps}). */
	simViewer: z.enum([
		"owner_admin",
		"manager",
		"freelancer_assigned",
		"freelancer_unassigned",
	]).optional(),
	/** DEV-ONLY. Override the engagement format so pipeline/one-off/session rules can be checked. */
	simProjectType: ProjectFormat.optional(),
	/** DEV-ONLY. Force the pending-invitation queue on/off. */
	simPendingInvites: z.boolean().optional(),
});
export type MemberRosterParams = z.infer<typeof MemberRosterParamsSchema>;
// #endregion

// #region Page envelope
/** The full roster projection the Members tab renders. */
export const MemberRosterPageSchema = z.object({
	scope: MemberScope,
	projectId: z.string().min(1).max(120),
	channelId: z.string().max(120).nullable(),
	/** The channel/stage name in channel scope; null in project scope. */
	channelName: z.string().max(160).nullable(),
	channelKind: ChannelKind.nullable(),
	projectTitle: z.string().min(1).max(160),
	/** The (possibly dev-overridden) engagement format — drives the stage-assignment columns. */
	format: ProjectFormat,
	members: z.array(ProjectMemberRowSchema),
	invites: z.array(MemberInviteSchema),
	/** Every stage of the engagement — the stage filter + the invite/assign picker. */
	stages: z.array(MemberStageRefSchema),
	/** The acting viewer's participant id — the "You" marker + self-action guard. */
	viewerId: z.string().max(120),
	viewerRole: MemberRole,
	viewerCaps: MemberViewerCapsSchema,
	/** Total participants (drives the "N members" caption; independent of any client-side filter). */
	total: z.number().int().min(0),
});
export type MemberRosterPage = z.infer<typeof MemberRosterPageSchema>;
// #endregion
