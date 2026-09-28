import { z } from "zod";
import { MoneyViewSchema } from "../finance/wallet.ts";
import {
	VerificationState,
	WorkspaceCapability,
	WorkspaceKind,
	WorkspaceRole,
	WorkspaceStatus,
} from "./common.ts";
import {
	IncomingInviteSchema,
	WorkspaceInviteSchema,
	WorkspaceMemberSchema,
	WorkspaceRoleDefSchema,
} from "./members.ts";
import { BusinessSpendPolicySchema, TeamPayoutPolicySchema } from "./policy.ts";

/**
 * workspace/workspace — the read projections the `/teams` and `/businesses` surfaces render, plus the
 * mutation payloads they write.
 *
 * The roster ({@link WorkspaceSummary}) and the console ({@link WorkspaceDetail}) are deliberately two
 * shapes: the index paints dozens of cards and must not drag a full member roster, role table and
 * money policy per card across the wire.
 */

// #region Roster
/** The three live stats a roster card carries — chosen per kind so the number always means something. */
export const WorkspaceStatSchema = z.object({
	label: z.string().max(32),
	/** Pre-formatted value ("12", "£4,280") — the client never formats money or compacts a figure. */
	value: z.string().max(24),
	/** Signed period-over-period delta for the stat tile contract, or `null` when not applicable. */
	delta: z.string().max(16).nullable().default(null),
});
export type WorkspaceStat = z.infer<typeof WorkspaceStatSchema>;

/** A member's face on a roster card's avatar stack. */
export const MemberFaceSchema = z.object({
	handle: z.string().max(40),
	name: z.string().max(120),
	avatar: z.string().max(400),
});
export type MemberFace = z.infer<typeof MemberFaceSchema>;

/** One entity on the roster index. */
export const WorkspaceSummarySchema = z.object({
	id: z.string().max(64),
	kind: WorkspaceKind,
	name: z.string().max(120),
	/** `@handle` without the `@`. */
	handle: z.string().max(40),
	/** Entity mark — a logo URL, or `""` to fall back to the initial badge. */
	avatar: z.string().max(400),
	status: WorkspaceStatus,
	verification: VerificationState,
	/** The viewer's role in this entity. */
	role: WorkspaceRole,
	/** Whether the viewer owns it — drives the `Owned` / `Member of` roster tabs. */
	isOwner: z.boolean(),
	memberCount: z.number().int().min(0),
	/** Up to five faces for the stack; the card renders a `+N` for the remainder. */
	faces: z.array(MemberFaceSchema),
	stats: z.array(WorkspaceStatSchema),
	/** Unseen activity — a pulsing dot, never a count (§D.1). */
	hasUpdate: z.boolean().default(false),
	/** Whether the session is currently ACTING as this entity. At most one summary may carry it. */
	isActing: z.boolean().default(false),
	/** One-line description shown under the name. */
	tagline: z.string().max(160),
	/** How complete the Draft-First setup is, 0–1. `1` hides the checklist. */
	setupProgress: z.number().min(0).max(1).default(1),
});
export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;

/** The roster page — every entity the viewer belongs to, plus the invitations awaiting them. */
export const WorkspaceRosterSchema = z.object({
	kind: WorkspaceKind,
	items: z.array(WorkspaceSummarySchema),
	/** Invitations addressed to the viewer — the index's dismissible strip. */
	invitations: z.array(IncomingInviteSchema),
	/** The id of the entity the session is acting as, or `null` when acting personally. */
	actingId: z.string().max(64).nullable(),
	/** Whether the viewer may create another entity of this kind (plan metering, brief §8 Settings). */
	canCreate: z.boolean().default(true),
	/** Why creation is unavailable, when it is. */
	createBlockedReason: z.string().max(200).nullable().default(null),
});
export type WorkspaceRoster = z.infer<typeof WorkspaceRosterSchema>;
// #endregion

// #region Setup checklist
/** One row of the Draft-First "Finish setting up" checklist. */
export const SetupStepSchema = z.object({
	id: z.enum(["logo", "bio", "invite", "money", "verification"]),
	label: z.string().max(80),
	/** What doing it gets them — never a bare instruction. */
	note: z.string().max(160),
	done: z.boolean(),
	/** Where the step's action goes (a module route, or `""` for an in-place action). */
	href: z.string().max(200),
});
export type SetupStep = z.infer<typeof SetupStepSchema>;
// #endregion

// #region Console detail
/** The workspace's money summary — tiles + a deep link, never a second finance UI (brief §7). */
export const WorkspaceFinanceSchema = z.object({
	available: MoneyViewSchema,
	/** Escrowed / committed. */
	locked: MoneyViewSchema,
	/** Clearing (team) or committed-but-unspent (business). */
	pending: MoneyViewSchema,
	/** The `/wallet?w=scope:id` deep link this entity's finance page hands off to. */
	walletHref: z.string().max(200),
	/** Sparkline points, 0–1, for the stat-tile accent. */
	trend: z.array(z.number().min(0).max(1)).default([]),
	/** Signed period delta, pre-formatted. */
	delta: z.string().max(16).nullable().default(null),
});
export type WorkspaceFinance = z.infer<typeof WorkspaceFinanceSchema>;

/** A project the entity is delivering (team) or has commissioned (business). */
export const WorkspaceProjectSchema = z.object({
	id: z.string().max(64),
	title: z.string().max(160),
	href: z.string().max(200),
	/** Pre-resolved counterparty name (the client for a team, the provider for a business). */
	counterparty: z.string().max(120),
	counterpartyAvatar: z.string().max(400),
	state: z.enum(["active", "proposal", "completed"]),
	/** Short status word rendered beside an icon, never a sentence (§B.6). */
	statusLabel: z.string().max(32),
	/** Completion 0–1. */
	progress: z.number().min(0).max(1),
	/** Pre-formatted next milestone date ("20–24 July"). */
	due: z.string().max(40).nullable(),
});
export type WorkspaceProject = z.infer<typeof WorkspaceProjectSchema>;

/** One line of the overview's recent-activity feed. */
export const ActivityEntrySchema = z.object({
	id: z.string().max(64),
	/** Drives the leading glyph. */
	kind: z.enum(["member", "project", "money", "role", "listing", "system"]),
	/** One line — the feed is scannable, so this is a fragment, not a paragraph. */
	text: z.string().max(200),
	actor: z.string().max(120).nullable(),
	actorAvatar: z.string().max(400).nullable(),
	at: z.string().max(40),
	href: z.string().max(200).nullable().default(null),
});
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;

/** The full console projection for one entity. */
export const WorkspaceDetailSchema = z.object({
	id: z.string().max(64),
	kind: WorkspaceKind,
	name: z.string().max(120),
	handle: z.string().max(40),
	avatar: z.string().max(400),
	/** Banner image reused from the public profile — the console never forks presentation (brief §7). */
	banner: z.string().max(400),
	tagline: z.string().max(160),
	status: WorkspaceStatus,
	verification: VerificationState,
	/** What clears the verification lock; `null` once verified. */
	verificationPrompt: z.string().max(200).nullable(),
	/** ISO creation date. */
	createdAt: z.string().max(40),

	// Viewer-scoped
	/** The viewer's role id ({@link WorkspaceRoleDef.id}). */
	viewerRoleId: z.string().max(64),
	/** The viewer's member id. */
	viewerMemberId: z.string().max(64),
	/** The viewer's effective capabilities — server-resolved, so the client never recomputes the union. */
	viewerCapabilities: z.array(WorkspaceCapability),
	/** Whether the session is acting as this entity right now. */
	isActing: z.boolean(),

	// Membership
	members: z.array(WorkspaceMemberSchema),
	roles: z.array(WorkspaceRoleDefSchema),
	invites: z.array(WorkspaceInviteSchema),

	// Money — exactly one is present, matching {@link kind}.
	payout: TeamPayoutPolicySchema.nullable(),
	spend: BusinessSpendPolicySchema.nullable(),
	finance: WorkspaceFinanceSchema,

	// Surfaces
	projects: z.array(WorkspaceProjectSchema),
	activity: z.array(ActivityEntrySchema),
	setup: z.array(SetupStepSchema),

	/** Earned Standing rung label, or `null` before the ladder applies. */
	standing: z.string().max(40).nullable().default(null),
	/**
	 * Whether the team may send proposals. A one-person team is LEGAL — it simply cannot bid
	 * (PRODUCT_SPEC ≥2 members; brief §12B (d)), so this is surfaced as an honest pre-state rather
	 * than a creation block. Always `true` for a business.
	 */
	canPropose: z.boolean().default(true),
});
export type WorkspaceDetail = z.infer<typeof WorkspaceDetailSchema>;
// #endregion

// #region Mutations
/**
 * Create — Draft-First: name + handle is the whole form (brief §5). The logo is added afterwards
 * through the media pipeline (the profile editor), never as a URL a client supplies.
 */
export const CreateWorkspaceInputSchema = z.object({
	kind: WorkspaceKind,
	name: z.string().min(2, "Give it a name.").max(80),
	handle: z.string()
		.min(3, "Handles are at least 3 characters.")
		.max(40)
		.regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Lowercase letters, numbers and hyphens only."),
});
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceInputSchema>;

/**
 * Update the entity's identity or lifecycle. Every field optional — this is a patch. Pictures are not
 * here: they move through the media pipeline (`org.set_profile_avatar`), which scans and re-encodes.
 */
export const UpdateWorkspaceInputSchema = z.object({
	kind: WorkspaceKind,
	id: z.string().max(64),
	name: z.string().min(2).max(80).optional(),
	tagline: z.string().max(160).optional(),
	status: WorkspaceStatus.optional(),
});
export type UpdateWorkspaceInput = z.infer<typeof UpdateWorkspaceInputSchema>;

/** Invite somebody by handle or email, to one of the entity's roles. */
export const InviteMemberInputSchema = z.object({
	kind: WorkspaceKind,
	workspaceId: z.string().max(64),
	/** One of these must be present — checked in {@link inviteTargetOf}. */
	handle: z.string().max(40).optional(),
	email: z.string().max(160).optional(),
	roleId: z.string().max(64),
	note: z.string().max(400).optional(),
});
export type InviteMemberInput = z.infer<typeof InviteMemberInputSchema>;

/** The addressable target of an invite, or `null` when neither field was supplied. */
export function inviteTargetOf(input: InviteMemberInput): string | null {
	return input.handle?.trim() || input.email?.trim() || null;
}

/**
 * Change a member: role, overrides, title, org-chart edge, spend envelope, or removal. Leaving is the
 * same patch applied to one's own row with `remove: true`.
 */
export const UpdateMemberInputSchema = z.object({
	kind: WorkspaceKind,
	workspaceId: z.string().max(64),
	memberId: z.string().max(64),
	roleId: z.string().max(64).optional(),
	granted: z.array(WorkspaceCapability).optional(),
	revoked: z.array(WorkspaceCapability).optional(),
	title: z.string().max(80).nullable().optional(),
	/** The member id this one reports to, or `null` to make them a root. */
	reportsTo: z.string().max(64).nullable().optional(),
	/** Business only — the member's spend envelope, in the business's default currency. */
	spendLimitMinor: z.number().int().min(0).nullable().optional(),
	perTransactionMinor: z.number().int().min(0).nullable().optional(),
	canSpend: z.boolean().optional(),
	/** Remove them from the entity (soft — becomes `left`). */
	remove: z.boolean().optional(),
});
export type UpdateMemberInput = z.infer<typeof UpdateMemberInputSchema>;

/** Hand the owner seat to another active member — one act, never two role edits. */
export const TransferOwnershipInputSchema = z.object({
	kind: WorkspaceKind,
	workspaceId: z.string().max(64),
	successorMemberId: z.string().max(64),
	/** Leave the entity in the same act, rather than staying on as an admin. */
	leave: z.boolean().default(false),
});
export type TransferOwnershipInput = z.infer<typeof TransferOwnershipInputSchema>;

/** Revoke or resend a pending invitation (the inviting side's two queue actions). */
export const InviteActionInputSchema = z.object({
	kind: WorkspaceKind,
	workspaceId: z.string().max(64),
	inviteId: z.string().max(64),
	action: z.enum(["revoke", "resend"]),
});
export type InviteActionInput = z.infer<typeof InviteActionInputSchema>;

/** Accept or decline an invitation addressed to the viewer. */
export const RespondInviteInputSchema = z.object({
	inviteId: z.string().max(64),
	accept: z.boolean(),
});
export type RespondInviteInput = z.infer<typeof RespondInviteInputSchema>;

/** Create or edit a custom role. */
export const UpsertRoleInputSchema = z.object({
	kind: WorkspaceKind,
	workspaceId: z.string().max(64),
	/** Absent when creating. */
	roleId: z.string().max(64).optional(),
	name: z.string().min(1).max(48),
	summary: z.string().max(160).default(""),
	capabilities: z.array(WorkspaceCapability),
	/** The preset it ranks as. Never `owner`, and never above the author's own rank (server-checked). */
	basePreset: WorkspaceRole.exclude(["owner"]).default("member"),
});
export type UpsertRoleInput = z.infer<typeof UpsertRoleInputSchema>;

/** Retire a custom role (archived, never deleted). Refused while anybody holds or is offered it. */
export const ArchiveRoleInputSchema = z.object({
	kind: WorkspaceKind,
	workspaceId: z.string().max(64),
	roleId: z.string().max(64),
});
export type ArchiveRoleInput = z.infer<typeof ArchiveRoleInputSchema>;

/** Write a team's split. Rejected server-side unless the active members' stakes sum to exactly 100%. */
export const UpdatePayoutInputSchema = z.object({
	workspaceId: z.string().max(64),
	stakes: z.array(z.object({
		memberId: z.string().max(64),
		shareBp: z.number().int().min(0).max(10_000),
		held: z.boolean().default(false),
	})).min(1),
});
export type UpdatePayoutInput = z.infer<typeof UpdatePayoutInputSchema>;

/**
 * Write a business's spend policy — a patch; a key present is a change. The threshold is at least one
 * minor unit or `null` (off): `0` would read as "every spend needs approval" to one reader and as
 * "disabled" to another, so it is not a value this schema admits.
 */
export const UpdateSpendInputSchema = z.object({
	workspaceId: z.string().max(64),
	/** Which of the business's wallets the threshold and limits apply to; the default currency when absent. */
	currency: z.string().regex(/^[A-Z]{3}$/).optional(),
	approvalThresholdMinor: z.number().int().min(1).nullable().optional(),
	approverIds: z.array(z.string().max(64)).optional(),
	contributorIds: z.array(z.string().max(64)).optional(),
	limits: z.array(z.object({
		memberId: z.string().max(64),
		canSpend: z.boolean(),
		limitMinor: z.number().int().min(0).nullable(),
		perTransactionMinor: z.number().int().min(0).nullable(),
	})).optional(),
});
export type UpdateSpendInput = z.infer<typeof UpdateSpendInputSchema>;

/** Switch the session's acting context. `null` returns to personal. */
export const SwitchContextInputSchema = z.object({
	contextType: z.enum(["personal", "team", "business", "organisation"]),
	contextId: z.string().max(64).nullable(),
});
export type SwitchContextInput = z.infer<typeof SwitchContextInputSchema>;

/** The outcome of a handle-availability probe. */
export const HandleCheckSchema = z.object({
	handle: z.string().max(40),
	available: z.boolean(),
	/** Why it is unavailable — taken, reserved, or malformed. */
	reason: z.string().max(160).nullable(),
	/** Suggestions when taken. */
	suggestions: z.array(z.string().max(40)).default([]),
});
export type HandleCheck = z.infer<typeof HandleCheckSchema>;
// #endregion

// #region Derived helpers
/** Overall setup completion, 0–1 — drives the checklist's ring and its auto-dismissal at 1. */
export function setupProgress(steps: readonly SetupStep[]): number {
	if (steps.length === 0) return 1;
	return steps.filter((s) => s.done).length / steps.length;
}

/** The route base for an entity kind (`/teams` · `/businesses`). */
export function workspaceBase(kind: WorkspaceKind): string {
	return kind === "team" ? "/teams" : "/businesses";
}

/**
 * The console href for an entity, optionally deep into a module. Consoles are addressed by the
 * entity's `@handle` (Decision #122) — the same address as its public profile, one namespace — never by
 * its row id.
 */
export function workspaceHref(
	kind: WorkspaceKind,
	handle: string,
	module?: string,
): string {
	const base = `${workspaceBase(kind)}/${handle}`;
	return module && module !== "overview" ? `${base}/${module}` : base;
}

/**
 * The wallet deep link for an entity — the finance page hands off here rather than rendering a second
 * finance UI. Note the `?w=` scope param is a **page-local view filter** on `/wallet`, NOT a session
 * context switch (brief §6.1) — the two switchers stay distinct on purpose.
 */
export function walletHrefFor(kind: WorkspaceKind, id: string): string {
	return `/wallet?w=${kind}:${id}`;
}
// #endregion
