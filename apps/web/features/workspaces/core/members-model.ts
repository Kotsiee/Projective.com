import type { MetaLineEntry } from "@ui/display/core/meta-line.tsx";
import type { MenuItem } from "@ui/types/mod.ts";
import { composeMenu, linkActionItems } from "@ui/navigation/core/link-actions.ts";
import type { ButtonSemanticTone } from "@ui/fields/types/button.ts";
import { readPayoutGateDetails } from "@projective/types/finance";
import {
	CAPABILITY_LABEL,
	CONSEQUENTIAL,
	handleRefusalOf,
	kindCopy,
	type PermissionFacet,
	permissionFacets,
	readTeamPersonaDetails,
	readTeamSeatCapDetails,
	reservedCapabilities,
	roleLabel,
	roleRank,
	TEAM_FULL_REFUSAL,
	type WorkspaceCapability,
	type WorkspaceKind,
	type WorkspaceMember,
	type WorkspaceRoleDef,
	type WorkspaceSeats,
} from "@projective/types/workspace";
import { HANDLE_CHECK_FAILED, type HandleCheckState } from "./handle-check.ts";
import { capabilityGroupsFor } from "./capabilities.ts";

/**
 * members-model — every rule the Members module renders, as pure functions (Teams work order C2).
 *
 * The People table and cards, the member drawer, the invite dialog and the ownership transfer are
 * bindings over this file: which actions a viewer is offered on a row (the RANK RULE), how a role, an
 * override set, a stake and a workload read, what the header says about seats, which roles an inviter
 * may offer, how a handle lookup reads for an invitation, what a transfer discloses and how its
 * refusals are worded, how a capability switch moves the override sets, which fields a save sends, and
 * which buttons each region holds. Teams and Businesses share it (Decision #61); a team-only rule is
 * gated on `kind === "team"`.
 *
 * **Absent, not disabled.** An action the viewer cannot perform is not offered at all — the same rule
 * the database applies (`org.update_workspace_member`: `manage_roles` and a strictly higher rank to
 * change somebody, `remove_members` as well to remove them, the owner's standing only by transfer).
 * A greyed-out control that can never become live is a control that does nothing (§3.11).
 *
 * Pure: no preact, no CSS, no network — `deno test` reads it directly.
 */

// #region Buttons
/** A button's place on the Interaction Matrix (§B.8.1): tier 3 commit · tier 5 escape · a text link. */
export type MembersTier = 3 | 5 | "link";

/** One button a Members surface renders. */
export interface MembersAction {
	key: string;
	label: string;
	tier: MembersTier;
	/** A destructive act — the danger ramp on the same tier. */
	danger?: boolean;
	disabled?: boolean;
	/** The act is in flight: the control shows progress and does not repeat. */
	busy?: boolean;
}

/** The Button props a tier draws with — every Members button takes its tone from here. */
export function membersTierProps(tier: MembersTier, danger = false): ButtonSemanticTone {
	if (tier === 3) return danger ? { variant: "filled", severity: "danger" } : { variant: "filled" };
	if (tier === 5) return danger ? { variant: "text", severity: "danger" } : { variant: "text" };
	return { variant: "link" };
}

/** How many filled buttons a region draws — the merge gate is "at most one" (§B.8.1). */
export function filledCount(actions: readonly MembersAction[]): number {
	return actions.filter((a) => a.tier === 3).length;
}
// #endregion

// #region The rank rule
/** What a viewer's authority over one roster row is decided from. */
export interface MemberActionInput {
	/** `roleRank` of the viewer's preset (a custom role ranks as its base); `0` for no seat. */
	viewerRank: number;
	/** `roleRank` of the row's preset. */
	targetRank: number;
	/** The viewer's server-resolved effective capabilities. */
	caps: readonly WorkspaceCapability[];
	/** The row is the viewer. */
	self: boolean;
	/** The row holds the owner seat. */
	targetIsOwner: boolean;
}

/** Everything a viewer may do to a row — each one present only when the database would allow it. */
export interface MemberAbilities {
	/** Change their role, permission overrides, title or reporting line. */
	edit: boolean;
	/** Remove them (soft — they become `left`). */
	remove: boolean;
	/** Leave, on the viewer's own row. */
	leave: boolean;
	/** Hand the owner seat over, on the owner's own row. */
	transfer: boolean;
	/** Message them — anybody but yourself. */
	message: boolean;
}

/**
 * The rank rule, mirroring `org.update_workspace_member` and `org.transfer_workspace_ownership`:
 * changing somebody needs `manage_roles` and a strictly higher rank; removing them needs
 * `remove_members` too; nobody changes their own seat or the owner's; the owner's own row offers the
 * transfer and nobody's offers Leave or Remove on it.
 */
export function memberAbilities(input: MemberActionInput): MemberAbilities {
	const held = new Set(input.caps);
	const outranks = input.viewerRank > input.targetRank;
	const other = !input.self && !input.targetIsOwner;
	const edit = other && outranks && held.has("manage_roles");
	return {
		edit,
		remove: edit && held.has("remove_members"),
		leave: input.self && !input.targetIsOwner,
		transfer: input.self && input.targetIsOwner,
		message: !input.self,
	};
}

/** The rank rule's input for one row, read from the detail. */
export function actionInputFor(
	viewer: Pick<WorkspaceMember, "id" | "rolePreset"> | null,
	target: Pick<WorkspaceMember, "id" | "rolePreset" | "isSelf">,
	caps: readonly WorkspaceCapability[],
): MemberActionInput {
	return {
		viewerRank: viewer ? roleRank(viewer.rolePreset) : 0,
		targetRank: roleRank(target.rolePreset),
		caps,
		self: target.isSelf || (viewer !== null && viewer.id === target.id),
		targetIsOwner: target.rolePreset === "owner",
	};
}

/** Everything a row's menu can ask the screen to do. */
export type MemberAction = "open" | "message" | "profile" | "transfer" | "leave" | "remove";

/** The menu rows a viewer is offered on a row, in order — nothing they cannot do. */
export function memberActionKeys(abilities: MemberAbilities): MemberAction[] {
	const keys: MemberAction[] = ["open"];
	if (abilities.message) keys.push("message");
	keys.push("profile");
	if (abilities.transfer) keys.push("transfer");
	if (abilities.leave) keys.push("leave");
	if (abilities.remove) keys.push("remove");
	return keys;
}

/** The canonical profile link for a member — `/@handle`. */
export function memberProfileHref(handle: string): string {
	return `/@${handle.replace(/^@/, "")}`;
}

/** Options for {@link memberMenu}. */
export interface MemberMenuOptions {
	/** Told whether Copy link reached the clipboard, so the screen can say so. */
	onCopied?: (ok: boolean) => void;
}

/**
 * A row's menu — the card's kebab, the table's row actions and a right-click on either (Decision
 * #222): Open in new tab · Copy link, then Role and permissions · Message · View profile, then the
 * row's one terminal act when the viewer has it.
 */
export function memberMenu(
	member: WorkspaceMember,
	abilities: MemberAbilities,
	onAction: (action: MemberAction, member: WorkspaceMember) => void,
	options: MemberMenuOptions = {},
): MenuItem[] {
	const rows: Record<MemberAction, MenuItem> = {
		open: { key: "open", label: "Role and permissions", icon: "shield-check" },
		message: { key: "message", label: "Message", icon: "message" },
		profile: { key: "profile", label: "View profile", icon: "user" },
		transfer: {
			key: "transfer",
			label: "Transfer ownership…",
			icon: "keystone-check",
			hint: "Hand the owner seat to another member.",
		},
		leave: {
			key: "leave",
			label: "Leave",
			icon: "logout",
			danger: true,
			hint: "Your work stays on record; nothing is deleted.",
		},
		remove: { key: "remove", label: "Remove", icon: "user-minus", danger: true },
	};
	const keys = memberActionKeys(abilities);
	const own = keys.filter((k) => k === "open" || k === "message" || k === "profile");
	const terminal = keys.filter((k) => k === "transfer" || k === "leave" || k === "remove");
	const bind = (k: MemberAction): MenuItem => ({ ...rows[k], command: () => onAction(k, member) });
	const links = member.handle
		? linkActionItems({
			href: memberProfileHref(member.handle),
			title: member.name,
			include: ["open-new-tab", "copy-link"],
			onCopied: options.onCopied,
		})
		: [];
	return composeMenu(links, own.map(bind), terminal.map(bind));
}
// #endregion

// #region Roles
/** The role row a member holds, or `null` when the table does not carry it. */
export function roleOf(
	member: Pick<WorkspaceMember, "roleId">,
	roles: readonly WorkspaceRoleDef[],
): WorkspaceRoleDef | null {
	return roles.find((r) => r.id === member.roleId) ?? null;
}

/** A role as one line of text: a preset by name, a custom role as "Name · based on Lead". */
export function roleDefText(role: WorkspaceRoleDef): string {
	return role.preset ? role.name : `${role.name} · based on ${roleLabel(role.basePreset)}`;
}

/** The role a member holds, as one line of text (the preset's label when the row is not in the table). */
export function roleText(
	member: Pick<WorkspaceMember, "roleId" | "rolePreset">,
	roles: readonly WorkspaceRoleDef[],
): string {
	const role = roleOf(member, roles);
	return role ? roleDefText(role) : roleLabel(member.rolePreset);
}

/** The role's own name, without its base — for a sentence ("From the Designer role"). */
export function roleName(
	member: Pick<WorkspaceMember, "roleId" | "rolePreset">,
	roles: readonly WorkspaceRoleDef[],
): string {
	return roleOf(member, roles)?.name ?? roleLabel(member.rolePreset);
}

/** A role as a picker option: its line of text, and its summary underneath. */
export interface RoleOption {
	value: string;
	label: string;
	description?: string;
}

/** The options a role picker lists, in the order given. */
export function roleOptions(roles: readonly WorkspaceRoleDef[]): RoleOption[] {
	return roles.map((r) => ({
		value: r.id,
		label: roleDefText(r),
		description: r.summary || undefined,
	}));
}

/**
 * The roles a viewer may OFFER — the invite dialog's list and the drawer's role picker. The mirror of
 * `org.invite_workspace_member` / `org.update_workspace_member`: never the owner seat (ownership moves
 * only by transfer), and never a role carrying a capability the viewer does not hold, because offering
 * a role is granting it. Archived roles never reach the detail.
 */
export function grantableRoles(
	roles: readonly WorkspaceRoleDef[],
	caps: readonly WorkspaceCapability[],
): WorkspaceRoleDef[] {
	const held = new Set(caps);
	return roles.filter((r) => r.basePreset !== "owner" && r.capabilities.every((c) => held.has(c)));
}

/**
 * The roles the drawer's picker lists for a member: the one they hold (so the picker always shows
 * where they stand), then every other role the viewer may grant.
 */
export function assignableRoles(
	roles: readonly WorkspaceRoleDef[],
	caps: readonly WorkspaceCapability[],
	currentRoleId: string,
): WorkspaceRoleDef[] {
	const grantable = new Set(grantableRoles(roles, caps).map((r) => r.id));
	return roles.filter((r) => r.id === currentRoleId || grantable.has(r.id));
}
// #endregion

// #region Row facts
/** A member's overrides, counted, with the grants that move money or authority picked out. */
export interface OverrideSummary {
	granted: WorkspaceCapability[];
	revoked: WorkspaceCapability[];
	/** The granted overrides on a consequential capability — the ones a reader must not miss. */
	sensitive: WorkspaceCapability[];
}

/** Read the overrides off the SSOT's facets — presented, never recomputed. */
export function overrideSummary(facets: readonly PermissionFacet[]): OverrideSummary {
	const granted = facets.filter((f) => f.override === "grant").map((f) => f.capability);
	const revoked = facets.filter((f) => f.override === "revoke").map((f) => f.capability);
	return { granted, revoked, sensitive: granted.filter((c) => CONSEQUENTIAL.includes(c)) };
}

/**
 * The overrides as a MetaLine: "+2 granted · −1 revoked", only the non-zero halves, and "Role default"
 * when there are none — an empty cell on a permission table reads as "not loaded".
 */
export function overrideItems(summary: OverrideSummary): MetaLineEntry[] {
	const items: MetaLineEntry[] = [];
	if (summary.granted.length > 0) {
		items.push({ text: `+${summary.granted.length} granted`, tabular: true });
	}
	if (summary.revoked.length > 0) {
		items.push({ text: `−${summary.revoked.length} revoked`, tabular: true });
	}
	return items.length > 0 ? items : ["Role default"];
}

/** Every override by name, for the summary's hover title ("Granted: … · Revoked: …"). */
export function overrideTitle(summary: OverrideSummary): string | undefined {
	const parts = [
		summary.granted.length > 0 &&
		`Granted: ${summary.granted.map((c) => CAPABILITY_LABEL[c]).join(", ")}`,
		summary.revoked.length > 0 &&
		`Revoked: ${summary.revoked.map((c) => CAPABILITY_LABEL[c]).join(", ")}`,
	].filter(Boolean);
	return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** The sensitive-grant count's accessible sentence, or `null` when there is none to count. */
export function sensitiveLabel(summary: OverrideSummary): string | null {
	const n = summary.sensitive.length;
	if (n === 0) return null;
	return `${n} sensitive ${n === 1 ? "grant" : "grants"}: ${
		summary.sensitive.map((c) => CAPABILITY_LABEL[c]).join(", ")
	}`;
}

/** Whether the viewer sees payout stakes: a team's, and only with `manage_finances` (Decision #233). */
export function showsStake(kind: WorkspaceKind, caps: readonly WorkspaceCapability[]): boolean {
	return kind === "team" && caps.includes("manage_finances");
}

/** A stake in basis points as a percentage — share arithmetic, which is exact: 1250 → "12.5%". */
export function stakePercent(shareBp: number): string {
	return `${(shareBp / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

/** A W_i figure: whole numbers bare, anything else to one decimal. */
export function formatWi(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** A member's workload as their live W_i over their cap — "3 / 10". */
export function workloadText(member: Pick<WorkspaceMember, "wi" | "wiCap">): string {
	return `${formatWi(member.wi)} / ${formatWi(member.wiCap)}`;
}
// #endregion

// #region Header
/** Whether the plan's seats are all taken or offered — `false` when unlimited or not seat-capped. */
export function seatsFull(seats: WorkspaceSeats | null): boolean {
	return seats !== null && seats.limit !== null && seats.used >= seats.limit;
}

/**
 * The seat fact: "5 of 15 seats" against a cap (its title says what holds them), else the head-count.
 * `used` counts open invitations as well as members — the count the cap is checked against.
 */
export function seatsItem(seats: WorkspaceSeats | null, activeCount: number): MetaLineEntry {
	if (seats && seats.limit !== null) {
		const offered = Math.max(0, seats.used - activeCount);
		return {
			text: `${seats.used} of ${seats.limit} seats`,
			tabular: true,
			title: offered > 0
				? `${activeCount} ${activeCount === 1 ? "member" : "members"} and ${offered} open ${
					offered === 1 ? "invitation" : "invitations"
				}`
				: undefined,
		};
	}
	return { text: `${activeCount} ${activeCount === 1 ? "member" : "members"}`, tabular: true };
}

/** "2 pending invitations", or nothing when none are waiting (or the viewer cannot see them). */
export function pendingItem(pending: number): MetaLineEntry | null {
	if (pending <= 0) return null;
	return {
		text: `${pending} pending ${pending === 1 ? "invitation" : "invitations"}`,
		tabular: true,
	};
}

/** The Members header's MetaLine: seats, then the pending invitations. */
export function membersHeaderItems(input: {
	seats: WorkspaceSeats | null;
	activeCount: number;
	pending: number;
}): MetaLineEntry[] {
	const pending = pendingItem(input.pending);
	return pending
		? [seatsItem(input.seats, input.activeCount), pending]
		: [seatsItem(input.seats, input.activeCount)];
}
// #endregion

// #region Invite
/** How an invitee is addressed. */
export type InviteMode = "handle" | "email";

/** The two routes to the same act — a handle when they are here, an email when they are not yet. */
export const INVITE_MODES: readonly { value: InviteMode; label: string; note: string }[] = [
	{ value: "handle", label: "By handle", note: "They are already on Projective." },
	{ value: "email", label: "By email", note: "They are not on Projective yet." },
];

/** A typed handle as the lookup takes it: lower case, no leading `@`, no spaces. */
export function normalizeInviteHandle(raw: string): string {
	return raw.trim().toLowerCase().replace(/^@+/, "").replace(/\s+/g, "");
}

/**
 * The role the dialog opens on: the seeded role when the viewer may offer it, else the Member preset,
 * else the first role they may offer, else none.
 */
export function inviteRoleSeed(
	grantable: readonly WorkspaceRoleDef[],
	seedId: string | null,
): string {
	if (seedId && grantable.some((r) => r.id === seedId)) return seedId;
	return grantable.find((r) => r.preset === "member")?.id ?? grantable[0]?.id ?? "";
}

/** The live line under the handle field. */
export interface InviteHandleLine {
	tone: "checking" | "found" | "unchecked" | "failed";
	text: string;
}

/**
 * What the live lookup says about a typed handle, reading R3's availability check the other way round:
 * a handle the namespace calls TAKEN belongs to somebody — the person to invite — and one it calls
 * AVAILABLE belongs to nobody. A handle outside the entity claim rule's charset may still be a
 * person's (usernames may hold `.` and `_`), so it is left for the server to look up on send.
 */
export function inviteHandleLine(
	state: HandleCheckState,
	memberHandles: ReadonlySet<string>,
): InviteHandleLine | null {
	if (state.failed) return { tone: "failed", text: HANDLE_CHECK_FAILED };
	if (state.status === "checking") {
		return { tone: "checking", text: `Looking up @${state.handle}…` };
	}
	if (state.status === "taken" && !memberHandles.has(state.handle)) {
		return { tone: "found", text: `@${state.handle} is on Projective.` };
	}
	if (state.status === "invalid" && handleRefusalOf(state.reason) === "format") {
		return { tone: "unchecked", text: `We'll look @${state.handle} up when you send.` };
	}
	return null;
}

/**
 * The handle field's problem for `useFieldValidation`, or `null`. Painted at rest, after the reader
 * leaves the field (§A.7).
 */
export function inviteHandleProblem(
	state: HandleCheckState,
	memberHandles: ReadonlySet<string>,
	kind: WorkspaceKind,
): string | null {
	if (state.failed) return null;
	if (state.status === "idle") return "Enter their handle.";
	if (memberHandles.has(state.handle)) {
		return `@${state.handle} is already in this ${kindCopy(kind).noun}.`;
	}
	if (state.status === "available") return `Nobody on Projective goes by @${state.handle}.`;
	if (state.status === "reserved") {
		return `@${state.handle} is a reserved word, not anyone's handle.`;
	}
	if (state.status === "invalid") {
		const code = handleRefusalOf(state.reason);
		return code === "format" ? null : state.reason;
	}
	return null;
}

/** The longest address `org.invite_workspace_member` accepts. */
export const INVITE_EMAIL_MAX = 160;

/** The email field's problem — the same shape `org.invite_workspace_member` checks. */
export function inviteEmailProblem(raw: string): string | null {
	const email = raw.trim();
	if (email === "") return "Enter their email address.";
	if (email.length > INVITE_EMAIL_MAX || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
		return "Enter a valid email address.";
	}
	return null;
}

/** What the invite dialog's commit is gated on. */
export interface InviteGateInput {
	mode: InviteMode;
	handle: HandleCheckState;
	email: string;
	roleId: string;
	sending: boolean;
	seats: WorkspaceSeats | null;
	memberHandles: ReadonlySet<string>;
	kind: WorkspaceKind;
}

/**
 * Whether Send opens: a role, a seat to offer, and an addressee the dialog has no reason to refuse —
 * a handle that is found, or that only the server can look up; a well-formed email.
 */
export function inviteGateOpen(input: InviteGateInput): boolean {
	if (input.sending || input.roleId === "" || seatsFull(input.seats)) return false;
	if (input.mode === "email") return inviteEmailProblem(input.email) === null;
	const state = input.handle;
	if (state.status === "checking") return false;
	if (inviteHandleProblem(state, input.memberHandles, input.kind) !== null) return false;
	return state.status === "taken" || state.status === "invalid" || state.failed;
}

/** The invite dialog's footer: Cancel (tier 5), then Send invitation (tier 3), gated. */
export function inviteFooter(input: InviteGateInput): MembersAction[] {
	return [
		{ key: "cancel", label: "Cancel", tier: 5 },
		{
			key: "send",
			label: input.sending ? "Sending…" : "Send invitation",
			tier: 3,
			disabled: !inviteGateOpen(input),
			busy: input.sending,
		},
	];
}

/** The invite dialog's MetaLine: seats left (or that the plan is full), then the pending count. */
export function inviteSeatItems(
	seats: WorkspaceSeats | null,
	pending: number,
): MetaLineEntry[] {
	const items: MetaLineEntry[] = [];
	if (seats && seats.limit !== null) {
		const left = Math.max(0, seats.limit - seats.used);
		items.push({
			text: left === 0
				? `All ${seats.limit} seats taken or offered`
				: `${left} of ${seats.limit} ${seats.limit === 1 ? "seat" : "seats"} free`,
			tabular: true,
		});
	}
	const waiting = pendingItem(pending);
	if (waiting) items.push(waiting);
	return items;
}

/** A refused invitation's sentence — by the envelope's typed `details`, never by its wording. */
export function inviteRefusalText(
	result: { message?: string; errors?: Record<string, string>; details?: unknown },
	addressee: string,
): string {
	if (readTeamSeatCapDetails(result.details)) {
		return `${TEAM_FULL_REFUSAL} Withdraw an invitation or upgrade the plan to offer another seat.`;
	}
	if (readTeamPersonaDetails(result.details)) {
		return `${addressee} can't join a team — teams are for freelancer accounts.`;
	}
	const field = result.errors?.handle ?? result.errors?.email ?? result.errors?.roleId ??
		result.errors?.note;
	return field ?? result.message ?? "Could not send that invitation.";
}
// #endregion

// #region Ownership transfer
/** Who may take the owner seat: active members other than the owner stepping back. */
export function transferCandidates(
	members: readonly WorkspaceMember[],
	leavingId: string,
): WorkspaceMember[] {
	return members.filter((m) => m.state === "active" && m.id !== leavingId);
}

/**
 * What the transfer does, said before it is confirmed — the dialog's required disclosure. On a team
 * the vault's withdrawals and its verification follow the owner, so the successor must be payout-ready
 * (Decision #196); on a business the owner-reserved rights move and every grant of them ends.
 */
export function transferConsequences(
	kind: WorkspaceKind,
	successor: string | null,
	leave: boolean,
): string[] {
	const who = successor ?? "The new owner";
	const you = leave
		? `You leave the ${kindCopy(kind).noun}; your work stays on record.`
		: "You stay on as an Admin.";
	if (kind === "team") {
		return [
			you,
			`Withdrawals from the vault move to ${who}.`,
			`${who} must have a verified identity and payout account.`,
		];
	}
	return [
		you,
		`Billing, withdrawals and archiving move to ${who}.`,
		"Every grant of those rights you made ends with the transfer.",
	];
}

/** The transfer dialog's footer: Cancel (tier 5), then the destructive confirm (tier 3, danger). */
export function transferFooter(input: { working: boolean; successorId: string }): MembersAction[] {
	return [
		{ key: "cancel", label: "Cancel", tier: 5 },
		{
			key: "transfer",
			label: input.working ? "Transferring…" : "Transfer ownership",
			tier: 3,
			danger: true,
			disabled: input.working || input.successorId === "",
			busy: input.working,
		},
	];
}

/** Which gate refused a transfer. */
export type TransferRefusalCode = "payout" | "persona" | "other";

/** A refused transfer, as the dialog's InlineNotice words it — naming the successor. */
export function transferRefusal(
	result: { message?: string; errors?: Record<string, string>; details?: unknown },
	successor: string,
): { code: TransferRefusalCode; text: string } {
	if (readPayoutGateDetails(result.details)) {
		return {
			code: "payout",
			text:
				`${successor} can't take ownership yet: they need a verified identity and payout account first.`,
		};
	}
	if (readTeamPersonaDetails(result.details)) {
		return {
			code: "persona",
			text: `${successor} can't own a team — teams are for freelancer accounts.`,
		};
	}
	return {
		code: "other",
		text: result.errors?.successorMemberId ?? result.errors?.owner ?? result.message ??
			"Could not transfer ownership.",
	};
}
// #endregion

// #region Member drawer
/** A member's overrides as the drawer edits them — the full sets, not a delta. */
export interface OverrideDraft {
	granted: readonly WorkspaceCapability[];
	revoked: readonly WorkspaceCapability[];
}

/** The facets the drawer previews: the SSOT's `permissionFacets` over the DRAFT role and overrides. */
export function draftFacets(
	member: Pick<WorkspaceMember, "rolePreset">,
	kind: WorkspaceKind,
	roles: readonly WorkspaceRoleDef[],
	roleId: string,
	overrides: OverrideDraft,
): PermissionFacet[] {
	const role = roles.find((r) => r.id === roleId);
	return permissionFacets(
		{
			rolePreset: role?.basePreset ?? member.rolePreset,
			overrides: { granted: [...overrides.granted], revoked: [...overrides.revoked] },
		},
		kind,
		roles,
		roleId,
	);
}

/**
 * Turn one capability on or off, relative to the role baseline: on a role capability clears its
 * revocation, on anything else grants it; off a role capability revokes it, off a granted one drops
 * the grant. The sets never hold a capability twice, nor one capability in both.
 */
export function toggleCapability(
	draft: OverrideDraft,
	facet: Pick<PermissionFacet, "capability" | "fromRole">,
	on: boolean,
): OverrideDraft {
	const cap = facet.capability;
	const granted = draft.granted.filter((c) => c !== cap);
	const revoked = draft.revoked.filter((c) => c !== cap);
	if (on && !facet.fromRole) granted.push(cap);
	if (!on && facet.fromRole) revoked.push(cap);
	return { granted, revoked };
}

/** Whether two capability lists hold the same capabilities, in any order. */
export function sameCapabilities(
	a: readonly WorkspaceCapability[],
	b: readonly WorkspaceCapability[],
): boolean {
	const left = new Set(a);
	const right = new Set(b);
	return left.size === right.size && [...left].every((c) => right.has(c));
}

/** Who decides what the drawer may change. */
export interface DrawerContext {
	kind: WorkspaceKind;
	/** The rank rule's `edit` for this row. */
	editable: boolean;
	/** The viewer's effective capabilities. */
	viewerCaps: readonly WorkspaceCapability[];
	/** The viewer holds the owner seat. */
	viewerIsOwner: boolean;
}

/**
 * Whether the viewer may flip one capability from where it stands: anything on may be taken away; an
 * off capability may be switched on only by a viewer who holds it (offering is granting), or — when
 * the role grants it — by clearing the revocation. A business's owner-reserved rights move only at
 * the owner's hand (Decision #230 (d)).
 */
export function capabilityToggleable(facet: PermissionFacet, ctx: DrawerContext): boolean {
	if (!ctx.editable) return false;
	if (reservedCapabilities(ctx.kind).includes(facet.capability) && !ctx.viewerIsOwner) return false;
	if (facet.effective) return true;
	return facet.fromRole || ctx.viewerCaps.includes(facet.capability);
}

/** What a sensitive capability lets its holder do — the drawer row's Meta warning. */
export function sensitiveWarning(
	capability: WorkspaceCapability,
	kind: WorkspaceKind,
): string | null {
	const noun = kindCopy(kind).noun;
	switch (capability) {
		case "bind_seat":
			return `Commits the ${noun} to paid work.`;
		case "spend_funds":
			return `Moves money out of the ${kindCopy(kind).moneyNoun}.`;
		case "withdraw_funds":
			return "Moves money out to a bank account.";
		case "approve_spend":
			return "Signs off other people's spending.";
		case "manage_billing":
			return "Pays the plan and the invoices.";
		case "manage_roles":
			return "Changes what everyone else may do.";
		case "archive_entity":
			return `Can archive the whole ${noun}.`;
		default:
			return null;
	}
}

/** One capability row of the drawer. */
export interface PermissionRow {
	capability: WorkspaceCapability;
	label: string;
	/** Whether the member ends up with it (the switch's value). */
	on: boolean;
	/** Whether the viewer may flip it — a row they may not is drawn as text, never a dead switch. */
	toggleable: boolean;
	/** Where the state comes from: the role, or an override on this person. */
	provenance: string;
	/** The consequence of holding a sensitive capability, or `null`. */
	warning: string | null;
}

/** One capability group of the drawer. */
export interface PermissionGroup {
	title: string;
	rows: PermissionRow[];
}

/** Where a capability's state comes from, as the drawer says it. */
export function provenanceText(facet: PermissionFacet, role: string): string {
	if (facet.override === "grant") return "Granted to this person on top of their role";
	if (facet.override === "revoke") return `Revoked from this person — the ${role} role grants it`;
	return facet.fromRole ? `From the ${role} role` : `Not in the ${role} role`;
}

/** The drawer's capability rows, in the shared groups (`capabilities.ts`). */
export function permissionGroups(
	facets: readonly PermissionFacet[],
	ctx: DrawerContext,
	role: string,
): PermissionGroup[] {
	const byCap = new Map(facets.map((f) => [f.capability, f]));
	return capabilityGroupsFor(ctx.kind)
		.map((group) => ({
			title: group.title,
			rows: group.capabilities.flatMap((cap) => {
				const facet = byCap.get(cap);
				if (!facet) return [];
				return [{
					capability: cap,
					label: CAPABILITY_LABEL[cap],
					on: facet.effective,
					toggleable: capabilityToggleable(facet, ctx),
					provenance: provenanceText(facet, role),
					warning: CONSEQUENTIAL.includes(cap) ? sensitiveWarning(cap, ctx.kind) : null,
				}];
			}),
		}))
		.filter((group) => group.rows.length > 0);
}

/** Everything the drawer edits, as the reader has left it. */
export interface MemberDraft {
	roleId: string;
	overrides: OverrideDraft;
	title: string;
	/** The member id they report to, or `""` for the top of the chart. */
	reportsTo: string;
}

/** The drawer's starting draft — the member as the server holds them. */
export function memberDraftOf(
	member: Pick<WorkspaceMember, "roleId" | "overrides" | "title" | "reportsTo">,
): MemberDraft {
	return {
		roleId: member.roleId,
		overrides: { granted: [...member.overrides.granted], revoked: [...member.overrides.revoked] },
		title: member.title ?? "",
		reportsTo: member.reportsTo ?? "",
	};
}

/** The fields a save sends — only what changed, since the patch is keyed and a key present is a change. */
export interface MemberPatch {
	roleId?: string;
	granted?: WorkspaceCapability[];
	revoked?: WorkspaceCapability[];
	title?: string | null;
	reportsTo?: string | null;
}

/** The patch from the saved member to the draft, or `null` when nothing changed. */
export function memberPatch(
	member: Pick<WorkspaceMember, "roleId" | "overrides" | "title" | "reportsTo">,
	draft: MemberDraft,
): MemberPatch | null {
	const patch: MemberPatch = {};
	if (draft.roleId !== member.roleId) patch.roleId = draft.roleId;
	const overridesChanged = !sameCapabilities(draft.overrides.granted, member.overrides.granted) ||
		!sameCapabilities(draft.overrides.revoked, member.overrides.revoked);
	if (overridesChanged) {
		patch.granted = [...draft.overrides.granted];
		patch.revoked = [...draft.overrides.revoked];
	}
	const title = draft.title.trim();
	if (title !== (member.title ?? "")) patch.title = title === "" ? null : title;
	if (draft.reportsTo !== (member.reportsTo ?? "")) {
		patch.reportsTo = draft.reportsTo === "" ? null : draft.reportsTo;
	}
	return Object.keys(patch).length > 0 ? patch : null;
}

/** The value of the "Reports to" picker that means nobody — the top of the chart. */
export const NOBODY = "__nobody";

/** Who a member may report to: nobody, or any other active member (a loop is the server's refusal). */
export function managerOptions(
	members: readonly WorkspaceMember[],
	member: Pick<WorkspaceMember, "id">,
): RoleOption[] {
	return [
		{ value: NOBODY, label: "Nobody — top of the chart" },
		...members
			.filter((m) => m.state === "active" && m.id !== member.id)
			.map((m) => ({ value: m.id, label: m.name, description: `@${m.handle}` })),
	];
}

/** The drawer's footer: Close (tier 5), and Save (tier 3) only where the viewer may edit. */
export function drawerFooter(input: {
	editable: boolean;
	dirty: boolean;
	saving: boolean;
}): MembersAction[] {
	const close: MembersAction = { key: "close", label: "Close", tier: 5 };
	if (!input.editable) return [close];
	return [close, {
		key: "save",
		label: input.saving ? "Saving…" : "Save changes",
		tier: 3,
		disabled: !input.dirty || input.saving,
		busy: input.saving,
	}];
}

/**
 * The drawer's terminal act, or `null`: the owner's own row offers the ownership transfer as a link
 * (never Leave or Remove); the viewer's own row offers Leave; another row offers Remove when the rank
 * rule allows it. All tier 5 — the destructive confirm comes after, in its own dialog.
 */
export function drawerTerminal(
	abilities: MemberAbilities,
	member: Pick<WorkspaceMember, "name">,
	kind: WorkspaceKind,
): MembersAction & { key: "transfer" | "leave" | "remove"; note: string } | null {
	const noun = kindCopy(kind).noun;
	if (abilities.transfer) {
		return {
			key: "transfer",
			label: "Transfer ownership",
			tier: "link",
			note: `You own this ${noun}. Ownership moves to another member before you can step back.`,
		};
	}
	if (abilities.leave) {
		return {
			key: "leave",
			label: `Leave ${noun}`,
			tier: 5,
			danger: true,
			note: "Your work stays on record — nothing is deleted — and an admin can invite you back.",
		};
	}
	if (abilities.remove) {
		return {
			key: "remove",
			label: `Remove ${member.name}`,
			tier: 5,
			danger: true,
			note: "Removing somebody keeps the record of their work — nothing is deleted.",
		};
	}
	return null;
}
// #endregion
