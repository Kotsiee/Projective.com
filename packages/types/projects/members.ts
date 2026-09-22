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

/**
 * Which space the roster is reading. `channel`/`project` are the engagement scopes; `conversation` is
 * the global-inbox scope (`/messages/[conversationId]/members`) — the SAME projection derived from a
 * conversation's participants, so the inbox mounts the identical Members roster rather than a
 * lookalike list. A conversation roster has no stages and no invitation queue.
 */
export const MemberScope = z.enum(["channel", "project", "conversation"]);
export type MemberScope = z.infer<typeof MemberScope>;

/**
 * The lifecycle of an invitation as the Invitations list renders it.
 *
 * `pending` is an open offer; `accepted` is the invitee's yes — the row stays, badged, because the
 * client's action on it is now "remove the freelancer it brought in"; `declined` is the invitee's no
 * — it stays in the list (so a client can see WHY they cannot re-invite) and starts the re-invitation
 * cooldown (`INVITE_COOLDOWN_DAYS`, `hire.ts`); `expired` is time's answer. The database's fifth
 * value, `revoked`, is the CLIENT's own act (cancelling a pending offer) and never renders — a client
 * withdrawing an offer does not need to be shown the offer they withdrew.
 *
 * The task vocabulary "rejected" is this enum's `declined`: the column, its `declined_at` twin and the
 * cooldown all speak `declined`, and a second spelling of one state is a second chance to disagree.
 */
export const InviteStatus = z.enum(["pending", "accepted", "declined", "expired"]);
export type InviteStatus = z.infer<typeof InviteStatus>;

/** What a managing viewer may do to an invitation, decided by its status alone. */
export const InviteAction = z.enum(["cancel", "dismiss", "remove"]);
export type InviteAction = z.infer<typeof InviteAction>;

/**
 * The one client action an invitation in a given state admits, or `null`.
 *
 * `pending` → **cancel** (withdraw the offer; the row becomes `revoked` and leaves the list).
 * `declined` / `expired` → **dismiss** (acknowledge the answer and take the record off the list; the
 * decline itself is KEPT, because the cooldown counts from it). `accepted` → **remove** the
 * freelancer the invitation brought in, which is a roster act rather than an invitation act and
 * carries the consequences {@link removalNotices} spells out. One rule, read by the list that renders
 * the control and the service that honours it, so a control can never be offered for a state the
 * write refuses.
 */
export function inviteActionFor(status: InviteStatus): InviteAction | null {
	switch (status) {
		case "pending":
			return "cancel";
		case "declined":
		case "expired":
			return "dismiss";
		case "accepted":
			return "remove";
	}
	return null;
}
// #endregion

// #region Removal impact
/**
 * What removing a participant would touch — the facts the confirmation reads its consequences from.
 *
 * Counted SERVER-side (the ticket and stage tables are the authority) and carried on the row so the
 * dialog that warns the client never has to fetch to say something true. Every figure is a count of
 * work UNDER WAY: a member with zeros everywhere can be removed with no financial consequence, which
 * is a sentence the dialog also has to be able to say.
 */
export const RemovalImpactSchema = z.object({
	/** Tickets this member holds that are `claimed` or `in_progress` — work they are doing now. */
	claimedTickets: z.number().int().min(0),
	/** Tickets this member has submitted (`in_review`) and that await the client's verdict. */
	submittedTickets: z.number().int().min(0),
	/**
	 * Stages this member contributes to whose work has started (`in_progress` · `submitted` ·
	 * `revisions`). Not a money fact — a seat opening up mid-stage — but a fact the client should
	 * hear before they confirm.
	 */
	startedStages: z.number().int().min(0),
});
export type RemovalImpact = z.infer<typeof RemovalImpactSchema>;

/** The impact of a participant nothing has been counted for — the neutral, not the unknown. */
export const NO_REMOVAL_IMPACT: RemovalImpact = {
	claimedTickets: 0,
	submittedTickets: 0,
	startedStages: 0,
};

/** English plural helper for the notices — `1 ticket` / `2 tickets`. */
function plural(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * The consequences of removing a participant, as the confirmation dialog states them.
 *
 * ONE implementation of `PRODUCT_SPEC.md` §"Freelancer Removal Mid-Ticket": a freelancer removed from
 * a stage or project while actively holding a claimed ticket has that ticket's escrow released to
 * them in full and the ticket returned to New. A ticket already SUBMITTED for review is still held
 * work under that rule — it releases the same way, and the submitted files stay with the project
 * (the client keeps drafts, as the Fair Exit logic in `finance-model.md` §3 also holds). A stage
 * merely under way with nothing claimed is a seat opening up, not a payout.
 *
 * Returned as sentences rather than flags so the dialog cannot phrase the rule a second way, and so
 * the empty case is stated positively — "no financial consequence" is information, not the absence
 * of a warning.
 */
export function removalNotices(impact: RemovalImpact | undefined | null): string[] {
	const facts = impact ?? NO_REMOVAL_IMPACT;
	const notices: string[] = [];
	if (facts.claimedTickets > 0) {
		const n = facts.claimedTickets;
		notices.push(
			`${plural(n, "claimed ticket")} ${n === 1 ? "is" : "are"} under way. The escrow held for ${
				n === 1 ? "it" : "each"
			} is released to them in full, and the ${
				n === 1 ? "ticket returns" : "tickets return"
			} to New for someone else to claim.`,
		);
	}
	if (facts.submittedTickets > 0) {
		const n = facts.submittedTickets;
		notices.push(
			`${plural(n, "submitted ticket")} ${
				n === 1 ? "is" : "are"
			} awaiting your review. Held work is paid out: the escrow releases to them in full, the ${
				n === 1 ? "ticket returns" : "tickets return"
			} to New, and the submitted files stay on the project.`,
		);
	}
	if (facts.startedStages > 0) {
		const n = facts.startedStages;
		notices.push(
			`They are contributing to ${plural(n, "stage")} already under way. ${
				n === 1 ? "That seat opens" : "Those seats open"
			} up again for someone else; the ${n === 1 ? "stage keeps" : "stages keep"} their funding.`,
		);
	}
	if (notices.length === 0) {
		notices.push(
			"They have not started any work here, so removing them has no financial consequence.",
		);
	}
	return notices;
}

/** Whether a removal touches money — decides the dialog's severity, not its presence. */
export function removalTouchesMoney(impact: RemovalImpact | undefined | null): boolean {
	const facts = impact ?? NO_REMOVAL_IMPACT;
	return facts.claimedTickets > 0 || facts.submittedTickets > 0;
}
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
	/**
	 * What removing this participant would touch — see {@link RemovalImpactSchema}. OPTIONAL (not
	 * defaulted) so every literal that builds a row keeps compiling; a reader treats absence as
	 * {@link NO_REMOVAL_IMPACT}, which is the neutral value and never a guess.
	 */
	impact: RemovalImpactSchema.optional(),
});
export type ProjectMemberRow = z.infer<typeof ProjectMemberRowSchema>;
// #endregion

// #region Pending invitation
/** One outstanding invitation in the Pending Invitations queue. */
export const MemberInviteSchema = z.object({
	id: z.string().min(1).max(120),
	/** The invited email address. */
	email: z.string().max(160),
	/**
	 * The invited `@handle`, when the invitation addressed a PLATFORM identity rather than an email —
	 * a client hiring a seller from their profile names a person, not an inbox. Absent on an
	 * email-addressed invitation; `email` then still carries the line the queue prints, so nothing
	 * that renders the queue has to branch. OPTIONAL (not defaulted) so every existing literal that
	 * builds an invite keeps compiling — a `.default()` is required on the OUTPUT side.
	 */
	handle: z.string().max(41).nullable().optional(),
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
	/**
	 * A STAGED assignment on an unpublished project: the seller is attached to the stage now, at no
	 * stated price, and the terms are settled when the client prices and publishes (root CLAUDE.md
	 * §8 Decision #108). An attribute of the invitation, not a lifecycle state — it stays `pending`
	 * and expires like any other. Absent (not `false`) on every invitation built before it existed.
	 */
	placeholder: z.boolean().optional(),
	/**
	 * When the invitee DECLINED — ISO, set iff `status === "declined"` (the DB pairs the two with
	 * `ck_project_invitations_declined_at`). The instant the re-invitation cooldown counts from.
	 * Optional (not defaulted) for the same reason as `handle`.
	 */
	declinedAt: z.string().nullable().optional(),
	/**
	 * When the invitee ACCEPTED — ISO, set iff `status === "accepted"` (`ck_project_invitations_accepted_at`).
	 * Optional for the same reason.
	 */
	acceptedAt: z.string().nullable().optional(),
	/**
	 * The roster row the accepted invitation brought in — `ProjectMemberRow.id` — so the list's
	 * "Remove" acts on the person and not on the record. `null` until accepted, and `null` on an
	 * accepted row whose participant the viewer cannot see. Optional for the same reason.
	 */
	memberId: z.string().max(120).nullable().optional(),
	/**
	 * When the record left the CLIENT's Invitations list — `projects.project_invitations.dismissed_at`:
	 * the client dismissing a declined or expired record, or a removal retiring an accepted one whose
	 * member is gone. Nothing else changes: the answer underneath is kept, and a dismissed decline still
	 * starts the re-invitation cooldown (`hire.ts`), which reads `declinedAt` and never this. An attribute
	 * of the record, never a status. Read paths filter dismissed rows out (`invitesForScope`), so a
	 * renderer rarely sees a non-null value here; the cooldown read is the one consumer that asks for them.
	 */
	dismissedAt: z.string().nullable().optional(),
});
export type MemberInvite = z.infer<typeof MemberInviteSchema>;

/**
 * The invitations a STAGE-scoped roster lists: exactly those addressed to that stage.
 *
 * `/projects/[project]/[stage]/members` answers "who is invited to THIS stage", so a whole-project
 * invitation (`stageId: null`) is not on it — that person was invited to the engagement, not to the
 * stage — and an invitation to a sibling stage is not either. Project scope (`stageId` null) lists
 * everything. Dismissed records are dropped everywhere: the client has already acknowledged them.
 *
 * Pure, and the one place the scoping rule lives, so the fixture branch, the live branch and the
 * island's own re-filter cannot each narrow the list a different way.
 */
export function invitesForScope(
	invites: readonly MemberInvite[],
	stageId: string | null,
): MemberInvite[] {
	return invites.filter((invite) => {
		if (invite.dismissedAt) return false;
		if (stageId === null) return true;
		return invite.stageId === stageId;
	});
}
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
	/**
	 * The routed STAGE's own id when this is a stage channel, else `null` — the key
	 * {@link invitesForScope} narrows the invitation list on. Carried separately from `channelId`
	 * because on the live path a stage's ROW id and its channel's id are two different strings (the
	 * fixtures happen to make them one, which is exactly why the distinction has to be explicit here).
	 * Defaulted so every existing page literal keeps parsing.
	 */
	stageId: z.string().max(120).nullable().default(null),
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

// #region Invitation & membership writes
/**
 * A client's act on ONE invitation they sent — `cancel` a pending offer (the row becomes `revoked`
 * and leaves the list) or `dismiss` a declined/expired record (the row gains `dismissed_at` and
 * leaves the list; the decline underneath is kept for the cooldown). Which of the two a row admits
 * is {@link inviteActionFor}'s decision, re-checked by the fat service — a client cannot dismiss an
 * open offer to make it disappear from their own queue, nor "cancel" a decline to reset a cooldown.
 *
 * `remove` is deliberately NOT one of these: an accepted invitation's action removes the PERSON, and
 * that is {@link RemoveMemberInputSchema}'s write, with its own consequences.
 */
export const InviteActionInputSchema = z.object({
	/** The project's route slug. */
	projectId: z.string().min(1).max(120),
	inviteId: z.string().min(1).max(120),
	action: z.enum(["cancel", "dismiss"]),
});
export type InviteActionInput = z.infer<typeof InviteActionInputSchema>;

/**
 * An invitee's answer to an invitation — or, in DEVELOPMENT ONLY, a forced one from the Dev Tools
 * Invites window so an invite flow can be walked through every state without a second account.
 *
 * The same shape serves both on purpose: the forced path must write exactly the rows a real
 * acceptance writes, and one payload into one service method is how that stays true. The service,
 * not this schema, decides who may send it (the invitee always; the project owner only where the
 * SERVER says it is a development environment).
 */
export const InviteDecisionInputSchema = z.object({
	projectId: z.string().min(1).max(120),
	inviteId: z.string().min(1).max(120),
	decision: z.enum(["accept", "decline"]),
});
export type InviteDecisionInput = z.infer<typeof InviteDecisionInputSchema>;

/**
 * Remove an active participant from the engagement, or from ONE of its stages.
 *
 * `stageId` is the removal's scope and it is the INVITATION's scope: an accepted stage invitation is
 * undone by unassigning the person from that stage, an accepted whole-project one by removing them
 * from the project. A stage-scoped removal leaves their other seats untouched. Consequences follow
 * `removalNotices` — the service applies them; this only names the target.
 */
export const RemoveMemberInputSchema = z.object({
	projectId: z.string().min(1).max(120),
	/** The roster row (`ProjectMemberRow.id`) — the participant, never a user id from the client. */
	memberId: z.string().min(1).max(120),
	/** The stage to unassign from, or `null`/absent to remove from the whole project. */
	stageId: z.string().max(120).nullable().default(null),
});
export type RemoveMemberInput = z.infer<typeof RemoveMemberInputSchema>;

/** What a removal reports back — the facts the confirmation warned about, as they were applied. */
export const RemoveMemberResultSchema = z.object({
	memberId: z.string().min(1).max(120),
	/** `stage` when only a seat was released, `project` when the person left the engagement. */
	removedFrom: z.enum(["project", "stage"]),
	impact: RemovalImpactSchema,
});
export type RemoveMemberResult = z.infer<typeof RemoveMemberResultSchema>;

/**
 * Every invitation the acting viewer has SENT, grouped by project — the Dev Tools Invites window's
 * read. Development-only on the server; a production caller is refused before the service is asked.
 */
export const SentInvitesPageSchema = z.object({
	projects: z.array(z.object({
		/** The project's route slug. */
		id: z.string().min(1).max(120),
		title: z.string().max(160),
		status: z.string().max(24),
		invites: z.array(MemberInviteSchema),
	})),
	/** Invitations across every project, before any per-project grouping. */
	total: z.number().int().min(0),
});
export type SentInvitesPage = z.infer<typeof SentInvitesPageSchema>;
// #endregion
