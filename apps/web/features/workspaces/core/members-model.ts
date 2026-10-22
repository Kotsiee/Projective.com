import type { MetaLineEntry } from "@ui/display/core/meta-line.tsx";
import type { MenuItem } from "@ui/types/mod.ts";
import { composeMenu, linkActionItems } from "@ui/navigation/core/link-actions.ts";
import type { ButtonNeutralTone, ButtonSemanticTone } from "@ui/fields/types/button.ts";
import { readPayoutGateDetails, readPlanGateDetails } from "@projective/types/finance";
import {
	type BusinessManagers,
	canOpenSpend,
	CAPABILITY_LABEL,
	CONSEQUENTIAL,
	handleRefusalOf,
	isBusinessManagerRole,
	isBusinessManagerSeat,
	isCoOwner,
	kindCopy,
	type PermissionFacet,
	permissionFacets,
	readTeamPersonaDetails,
	readTeamSeatCapDetails,
	RESERVED_GRANT_CONFIRMATION,
	reservedCapabilities,
	roleLabel,
	roleRank,
	type SpendLimit,
	TEAM_FULL_REFUSAL,
	type WorkspaceCapability,
	type WorkspaceDetail,
	type WorkspaceInvite,
	type WorkspaceKind,
	type WorkspaceMember,
	type WorkspaceRole,
	type WorkspaceRoleDef,
	type WorkspaceSeats,
} from "@projective/types/workspace";
import { HANDLE_CHECK_FAILED, type HandleCheckState } from "./handle-check.ts";
import { type CapabilityDomain, capabilityGroupsFor } from "./capabilities.ts";
import { BUSINESS_REFUSAL_COPY, PLANS_UNAVAILABLE } from "./refusal-copy.ts";
import { envelopeLine, envelopeSummary, type MetaFact, spendLimitHref } from "./spend-model.ts";

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
/**
 * A button's place on the Interaction Matrix (§B.8.1): tier 3 commit · tier 4 utility · tier 5
 * escape · a text link.
 */
export type MembersTier = 3 | 4 | 5 | "link";

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
export function membersTierProps(
	tier: MembersTier,
	danger = false,
): ButtonSemanticTone | ButtonNeutralTone {
	if (tier === 3) return danger ? { variant: "filled", severity: "danger" } : { variant: "filled" };
	if (tier === 4) return { variant: "outlined", severity: "neutral" };
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

/**
 * A role as ONE item of a MetaLine: a custom role reads "Designer (based on Lead)". The table's Role
 * cell keeps "Designer · based on Lead"; inside a MetaLine that middot would read as the line's own
 * separator and split one fact into two.
 */
export function roleMetaDefText(role: WorkspaceRoleDef): string {
	return role.preset ? role.name : `${role.name} (based on ${roleLabel(role.basePreset)})`;
}

/** The role a member holds, as one MetaLine item (see {@link roleMetaDefText}). */
export function roleMetaText(
	member: Pick<WorkspaceMember, "roleId" | "rolePreset">,
	roles: readonly WorkspaceRoleDef[],
): string {
	const role = roleOf(member, roles);
	return role ? roleMetaDefText(role) : roleLabel(member.rolePreset);
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
 * Whether an invitation's window has closed at `now` (epoch ms). A lapsed invitation stays in the
 * queue — it can be resent — but it holds no seat: `org.fn_team_seats_used` counts only unexpired ones.
 */
export function inviteLapsed(invite: Pick<WorkspaceInvite, "expiresAt">, now: number): boolean {
	if (!invite.expiresAt) return false;
	const at = new Date(invite.expiresAt).getTime();
	return Number.isFinite(at) && at <= now;
}

/** The outgoing queue split the way the seat count splits it: still open, and lapsed. */
export interface InviteCounts {
	/** Pending and unexpired — each holds a seat. */
	live: number;
	/** Pending but past their window — resendable, holding no seat. */
	lapsed: number;
}

/** Count the queue the viewer can see at `now` (epoch ms). */
export function inviteCounts(
	invites: readonly Pick<WorkspaceInvite, "expiresAt">[],
	now: number,
): InviteCounts {
	const lapsed = invites.filter((i) => inviteLapsed(i, now)).length;
	return { live: invites.length - lapsed, lapsed };
}

/**
 * The seat fact: "5 of 15 seats" against a cap, else the head-count. `used` counts open invitations as
 * well as members — the count the cap is checked against. Its title breaks that down into members and
 * open invitations only for a viewer who may see the invitation queue (`invite_members`): the console
 * read hides the queue from everybody else, and the title must not tell them its size.
 */
export function seatsItem(
	seats: WorkspaceSeats | null,
	activeCount: number,
	seesQueue = false,
): MetaLineEntry {
	if (seats && seats.limit !== null) {
		const offered = Math.max(0, seats.used - activeCount);
		return {
			text: `${seats.used} of ${seats.limit} seats`,
			tabular: true,
			title: seesQueue && offered > 0
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

/**
 * The lapsed invitations, or nothing: "1 lapsed" after a pending count, "1 lapsed invitation" on its
 * own — so a queue of only lapsed rows is still mentioned, never counted as pending.
 */
export function lapsedItem(counts: InviteCounts): MetaLineEntry | null {
	const n = counts.lapsed;
	if (n <= 0) return null;
	return {
		text: counts.live > 0 ? `${n} lapsed` : `${n} lapsed ${n === 1 ? "invitation" : "invitations"}`,
		tabular: true,
	};
}

/**
 * The Members header's MetaLine: seats (a business: the head-count, then its manager headroom), then
 * the pending invitations, then any lapsed ones.
 */
export function membersHeaderItems(input: {
	seats: WorkspaceSeats | null;
	activeCount: number;
	invites: InviteCounts;
	/** The viewer holds `invite_members` — the only viewer the console read shows the queue to. */
	seesQueue: boolean;
	/** A business's manager headroom (`WorkspaceDetail.managers`); absent or `null` for a team. */
	managers?: BusinessManagers | null;
}): MetaLineEntry[] {
	const items: MetaLineEntry[] = [seatsItem(input.seats, input.activeCount, input.seesQueue)];
	const managers = managersItem(input.managers ?? null);
	if (managers) items.push(managers);
	const pending = pendingItem(input.invites.live);
	if (pending) items.push(pending);
	const lapsed = lapsedItem(input.invites);
	if (lapsed) items.push(lapsed);
	return items;
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
	tone: "checking" | "unchecked" | "failed";
	text: string;
}

/**
 * What the live lookup says about a typed handle. R3's check asks the ONE shared handle namespace,
 * which holds people, teams, businesses, enterprises and the 90-day holds on renamed handles — so its
 * answers read only one way round for an invitation:
 *
 *   - AVAILABLE means nobody at all holds it, so nobody can be invited by it (a problem, below).
 *   - TAKEN means SOMETHING holds it, not that a person does: it may be a team's or a business's
 *     handle, or a renamed person's old one. `org.invite_workspace_member` resolves a handle from people
 *     only, so a taken handle is left for the server to look up on send — the line never claims a
 *     person was found.
 *
 * A handle outside the entity claim rule's charset may still be a person's (usernames may hold `.` and
 * `_`), so it too is left for the server. The entity's own handle and a current member's are problems,
 * not lines.
 */
export function inviteHandleLine(
	state: HandleCheckState,
	memberHandles: ReadonlySet<string>,
	ownHandle = "",
): InviteHandleLine | null {
	if (state.failed) return { tone: "failed", text: HANDLE_CHECK_FAILED };
	if (state.status === "checking") {
		return { tone: "checking", text: `Looking up @${state.handle}…` };
	}
	if (memberHandles.has(state.handle) || isOwnHandle(state.handle, ownHandle)) return null;
	const unchecked = state.status === "taken" ||
		(state.status === "invalid" && handleRefusalOf(state.reason) === "format");
	return unchecked
		? { tone: "unchecked", text: `We'll look @${state.handle} up when you send.` }
		: null;
}

/** Whether a typed handle is the entity's own — a team or business is never anyone to invite. */
function isOwnHandle(handle: string, ownHandle: string): boolean {
	return ownHandle !== "" && handle === ownHandle.toLowerCase();
}

/**
 * The handle field's problem for `useFieldValidation`, or `null`. Painted at rest, after the reader
 * leaves the field (§A.7).
 */
export function inviteHandleProblem(
	state: HandleCheckState,
	memberHandles: ReadonlySet<string>,
	kind: WorkspaceKind,
	ownHandle = "",
): string | null {
	if (state.failed) return null;
	if (state.status === "idle") return "Enter their handle.";
	const noun = kindCopy(kind).noun;
	if (memberHandles.has(state.handle)) return `@${state.handle} is already in this ${noun}.`;
	if (isOwnHandle(state.handle, ownHandle)) {
		return `@${state.handle} is this ${noun}'s own handle, not a person's.`;
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
	/** The entity's own handle — never an invitee. */
	ownHandle?: string;
	/** A business's manager headroom — an invitation to a manager's role takes one (BU7). */
	managers?: BusinessManagers | null;
	/** The roles on offer, to judge whether the chosen one is a manager's. */
	roles?: readonly WorkspaceRoleDef[];
}

/**
 * Whether the chosen role would pass a business's manager cap: it is a manager's role
 * ({@link inviteAddsManager}) and every manager seat is taken or offered ({@link managersFull}).
 * The server refuses it anyway (`PK402 entitlement: business_managers`); this says so first.
 */
export function inviteOverManagerCap(
	input: Pick<InviteGateInput, "kind" | "roleId" | "managers" | "roles">,
): boolean {
	const role = (input.roles ?? []).find((r) => r.id === input.roleId) ?? null;
	return inviteAddsManager(input.kind, role) && managersFull(input.managers ?? null);
}

/**
 * Whether Send opens: a role, a seat to offer, and an addressee the dialog has no reason to refuse —
 * a handle somebody holds or that only the server can judge (the server decides whether it is a
 * person's); a well-formed email. On a business, a manager's role while every manager seat is taken
 * or offered closes it too.
 */
export function inviteGateOpen(input: InviteGateInput): boolean {
	if (input.sending || input.roleId === "" || seatsFull(input.seats)) return false;
	if (inviteOverManagerCap(input)) return false;
	if (input.mode === "email") return inviteEmailProblem(input.email) === null;
	const state = input.handle;
	if (state.status === "checking") return false;
	if (inviteHandleProblem(state, input.memberHandles, input.kind, input.ownHandle) !== null) {
		return false;
	}
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

/**
 * A refused invitation's sentence — by the envelope's typed `details`, never by its wording. A
 * business's manager cap reads the refusal map's `entitlement` sentence ({@link managerCapRefusal}).
 */
export function inviteRefusalText(
	result: { message?: string; errors?: Record<string, string>; details?: unknown },
	addressee: string,
	ctx: ManagerCapContext = {},
): string {
	const cap = managerCapRefusal(result.details, ctx);
	if (cap) return cap;
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
	/** The successor mid-sentence, and at the start of one. */
	const who = successor ?? "the new owner";
	const subject = successor ?? "The new owner";
	const you = leave
		? `You leave the ${kindCopy(kind).noun}; your work stays on record.`
		: "You stay on as an Admin.";
	if (kind === "team") {
		return [
			you,
			`Withdrawals from the vault move to ${who}.`,
			`${subject} must have a verified identity and payout account.`,
		];
	}
	return [
		you,
		`Billing, withdrawals and archiving move to ${who}.`,
		"Every grant of those rights you made ends with the transfer.",
	];
}

/**
 * The transfer dialog's footer: Cancel (tier 5), then the destructive confirm (tier 3, danger). With
 * nobody to hand over to, the confirm could never become live (§3.11), so the dialog is an explanation
 * and its one button is Close.
 */
export function transferFooter(input: {
	working: boolean;
	successorId: string;
	/** How many members could take the owner seat. */
	candidates: number;
}): MembersAction[] {
	if (input.candidates === 0) return [{ key: "cancel", label: "Close", tier: 5 }];
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
	/**
	 * The rank the DRAFT role gives the member (its base preset). A business's billing right lives only
	 * on an admin seat, so it is offered only while the draft ranks as one.
	 */
	draftRank?: WorkspaceRole;
}

/**
 * Whether the viewer may flip one capability from where it stands: anything on may be taken away; an
 * off capability may be switched on only by a viewer who holds it (offering is granting), or — when
 * the role grants it — by clearing the revocation. A business's owner-reserved rights move only at
 * the owner's hand (Decision #230 (d)), and its billing right goes only to an admin seat
 * (`org.update_workspace_member`: "the billing right goes only to an admin").
 */
export function capabilityToggleable(facet: PermissionFacet, ctx: DrawerContext): boolean {
	if (!ctx.editable) return false;
	if (reservedCapabilities(ctx.kind).includes(facet.capability) && !ctx.viewerIsOwner) return false;
	if (facet.effective) return true;
	if (
		ctx.kind === "business" && facet.capability === "manage_billing" &&
		ctx.draftRank !== undefined && ctx.draftRank !== "admin"
	) return false;
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
	/** The typed answer to a reserved grant's warning (`RESERVED_GRANT_CONFIRMATION`), when one is owed. */
	confirm?: string;
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

/**
 * The drawer's footer: Close (tier 5), and Save (tier 3) only where the viewer may edit. Save stays
 * closed while the draft owes something the server would refuse without (`blocked`): the typed
 * confirmation of a reserved grant, or a manager seat the plan has none left of.
 */
export function drawerFooter(input: {
	editable: boolean;
	dirty: boolean;
	saving: boolean;
	blocked?: boolean;
	/** The escape's word — "Close" on a drawer, "Cancel" on the inspector's edit form. */
	closeLabel?: string;
}): MembersAction[] {
	const close: MembersAction = { key: "close", label: input.closeLabel ?? "Close", tier: 5 };
	if (!input.editable) return [close];
	return [close, {
		key: "save",
		label: input.saving ? "Saving…" : "Save changes",
		tier: 3,
		disabled: !input.dirty || input.saving || input.blocked === true,
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

// #region Member dossier (Decision #322)
/** One capability the dossier lists as held. */
export interface DossierGrant {
	capability: WorkspaceCapability;
	label: string;
	/** Held through an override on this person rather than through their role. */
	granted: boolean;
	/** What holding it lets them do, when that is severe — said inline beside it, or `null`. */
	warning: string | null;
}

/** One capability domain of the dossier: what the member holds in it, and what was taken away. */
export interface DossierDomain {
	key: CapabilityDomain;
	title: string;
	grants: DossierGrant[];
	/** The labels their role grants that were revoked from this person. */
	revoked: string[];
}

/**
 * The dossier's capability domains (People & access · Projects · Vault · Workspace), each listing
 * only what the member effectively holds — the readable counterpart of the edit form's switches.
 */
export function dossierDomains(
	facets: readonly PermissionFacet[],
	kind: WorkspaceKind,
): DossierDomain[] {
	const byCap = new Map(facets.map((f) => [f.capability, f]));
	return capabilityGroupsFor(kind).map((group) => {
		const held = group.capabilities.map((cap) => byCap.get(cap)).filter((f) => f !== undefined);
		return {
			key: group.key,
			title: group.title,
			grants: held.filter((f) => f.effective).map((f) => ({
				capability: f.capability,
				label: CAPABILITY_LABEL[f.capability],
				granted: f.override === "grant",
				warning: CONSEQUENTIAL.includes(f.capability)
					? sensitiveWarning(f.capability, kind)
					: null,
			})),
			revoked: held.filter((f) => f.override === "revoke").map((f) =>
				CAPABILITY_LABEL[f.capability]
			),
		};
	});
}

/** One figure of a meta line, set in tabular numerals. */
export interface MemberFigure {
	text: string;
	tabular: true;
}

/** The dossier head's figures: when they joined, a team member's workload, and the stake when seen. */
export function dossierFacts(
	member: Pick<WorkspaceMember, "wi" | "wiCap" | "shareBp">,
	kind: WorkspaceKind,
	showStake: boolean,
	joined: string,
): MemberFigure[] {
	const out: MemberFigure[] = [];
	if (joined !== "") out.push({ text: `Joined ${joined}`, tabular: true });
	if (kind === "team") out.push({ text: `Workload ${workloadText(member)}`, tabular: true });
	if (showStake) out.push({ text: `Stake ${stakePercent(member.shareBp)}`, tabular: true });
	return out;
}

/**
 * The org chart node's foot: a team member's workload and, for a viewer who sees stakes, their stake;
 * where neither applies (a business), when they joined — so the row is never empty.
 */
export function orgNodeMetrics(
	member: Pick<WorkspaceMember, "wi" | "wiCap" | "shareBp">,
	kind: WorkspaceKind,
	showStake: boolean,
	joined: string,
): MemberFigure[] {
	const figures = dossierFacts(member, kind, showStake, "");
	return figures.length > 0 ? figures : dossierFacts(member, kind, false, joined);
}

/** Who a member reports to and who reports to them, among the active members. */
export interface ReportingLine {
	manager: WorkspaceMember | null;
	reports: WorkspaceMember[];
}

/** The member's reporting line — a manager who left reads as nobody; reports read by name. */
export function reportingLine(
	members: readonly WorkspaceMember[],
	member: Pick<WorkspaceMember, "id" | "reportsTo">,
): ReportingLine {
	const active = members.filter((m) => m.state === "active" && m.id !== member.id);
	return {
		manager: active.find((m) => m.id === member.reportsTo) ?? null,
		reports: active
			.filter((m) => m.reportsTo === member.id)
			.sort((a, b) => a.name.localeCompare(b.name)),
	};
}
// #endregion

// #region Business specifics (BU7)
/**
 * The Title field's example, per kind. "Design lead" is a team's vocabulary; a business has no Lead
 * preset, and its console never says "lead" (BU7).
 */
export const TITLE_EXAMPLE: Readonly<Record<WorkspaceKind, string>> = {
	team: "Design lead",
	business: "Head of marketing",
};

/**
 * Whether the People reading shows each member's Spending: a business whose read gave the viewer
 * EVERY member's envelope (`spend.readsAllEnvelopes` — the server's `fn_business_envelopes` rule,
 * Decision #238 (E)), never inferred from which rows arrived.
 */
export function showsSpending(ws: Pick<WorkspaceDetail, "kind" | "spend">): boolean {
	return ws.kind === "business" && ws.spend?.readsAllEnvelopes === true;
}

/** A member's envelope as the read answered it to the viewer, or `null`. */
export function envelopeOf(
	ws: Pick<WorkspaceDetail, "spend">,
	memberId: string,
): SpendLimit | null {
	return ws.spend?.limits.find((l) => l.memberId === memberId) ?? null;
}

/**
 * The Spending column's sort key: spending off first, then the ceilings low to high, then no
 * ceiling (an ascending sort reads from the most to the least constrained).
 */
export function spendingSortValue(limit: SpendLimit | null): number {
	if (!limit || !limit.canSpend) return -1;
	return limit.limitMinor ?? Number.MAX_SAFE_INTEGER;
}

/** A member's envelope as ONE table or card fact, or `null` when the viewer does not read everyone's. */
export function spendingFact(
	ws: Pick<WorkspaceDetail, "kind" | "spend">,
	memberId: string,
): MetaFact | null {
	if (!showsSpending(ws)) return null;
	const limit = envelopeOf(ws, memberId);
	return limit ? envelopeSummary(limit) : null;
}

/** The member drawer's spend envelope section. */
export interface EnvelopeSection {
	/** The envelope in one line (`envelopeLine`): "US$500.00 / month · …" · "No ceiling" · "Spending off". */
	facts: MetaFact[];
	/** Where the envelope is set, as the section's note. */
	note: string;
	/** The tier-5 link to this member's row on the Spend module, or `null` where Spend does not open. */
	link: { label: string; href: string } | null;
}

/**
 * The drawer's spend envelope section, or `null`. It renders for the policy's editors
 * (`viewerCan.editPolicy`) — linked "Edit in Spend" to the member's row when their limits are the
 * viewer's to change (`spend.editableMemberIds`), "Open in Spend" otherwise — read-only for anyone
 * else who reads every envelope, and on the viewer's own row (their own envelope is theirs to read —
 * PRODUCT_SPEC "a member sees their own spending limit"; FLAG #249 (q)). Nothing for the rest, and
 * nothing for a team. The owner's row is set by nobody (`finance.save_spend_policy` skips the owner),
 * so its note says so rather than naming who sets it.
 */
export function envelopeSection(
	ws: Pick<WorkspaceDetail, "kind" | "handle" | "spend" | "viewerCan" | "viewerCapabilities">,
	member: Pick<WorkspaceMember, "id" | "handle" | "isSelf" | "rolePreset">,
): EnvelopeSection | null {
	if (ws.kind !== "business" || !ws.spend) return null;
	const editor = ws.viewerCan?.editPolicy === true;
	if (!editor && !ws.spend.readsAllEnvelopes && !member.isSelf) return null;
	const limit = envelopeOf(ws, member.id);
	if (!limit) return null;
	const editable = editor && ws.spend.editableMemberIds.includes(member.id);
	return {
		facts: envelopeLine(limit),
		note: editable
			? "Set on the spend policy, beside everyone else's — a limit only means something relative to the others."
			: member.rolePreset === "owner"
			? member.isSelf
				? "As the owner, your limit isn't set on the spend policy — nobody changes it there."
				: "The owner's limit isn't set on the spend policy — nobody changes it there."
			: member.isSelf
			? "Your limit, as the spend policy sets it."
			: "Set on the spend policy by the people who run it.",
		link: canOpenSpend(ws.kind, ws.viewerCapabilities)
			? {
				label: editable ? "Edit in Spend" : "Open in Spend",
				href: spendLimitHref(ws.handle, member.handle),
			}
			: null,
	};
}

/**
 * The manager headroom as a header fact — "1 of 2 managers", tabular — or `null` while nothing caps
 * it (the plan gates are off, or the plan is unlimited) and for a team.
 */
export function managersItem(
	managers: BusinessManagers | null,
): { text: string; tabular: true; title: string } | null {
	if (!managers || managers.limit === null) return null;
	return {
		text: `${managers.used} of ${managers.limit} ${managers.limit === 1 ? "manager" : "managers"}`,
		tabular: true,
		title: "Admins and roles that manage projects, with the invitations that offer one",
	};
}

/** Whether every manager seat is taken or offered — `false` when nothing caps them. */
export function managersFull(managers: BusinessManagers | null): boolean {
	return managers !== null && managers.limit !== null && managers.used >= managers.limit;
}

/**
 * Whether inviting somebody to a role takes a manager seat (Decision #230 (b)): a business role
 * ranked as an admin or holding `manage_projects` (`isBusinessManagerRole`, the mirror of
 * `org.fn_business_role_is_manager`).
 */
export function inviteAddsManager(
	kind: WorkspaceKind,
	role: Pick<WorkspaceRoleDef, "basePreset" | "capabilities"> | null,
): boolean {
	return kind === "business" && role !== null && isBusinessManagerRole(role);
}

/**
 * How many of a staged batch's manager seats are past a business's headroom (Decision #318): each
 * row offered a manager's role takes one (`inviteAddsManager`), against `limit − used`. `0` for a
 * team, an uncapped plan, or a batch that fits — the per-row twin of {@link inviteOverManagerCap}.
 */
export function inviteManagerOverflow(
	kind: WorkspaceKind,
	managers: BusinessManagers | null,
	roles: readonly Pick<WorkspaceRoleDef, "id" | "basePreset" | "capabilities">[],
	roleIds: readonly string[],
): number {
	if (kind !== "business" || managers === null || managers.limit === null) return 0;
	const byId = new Map(roles.map((r) => [r.id, r]));
	const asked = roleIds.filter((id) => inviteAddsManager(kind, byId.get(id) ?? null)).length;
	return Math.max(0, asked - Math.max(0, managers.limit - managers.used));
}

/** The rank a draft role gives a member — its base preset, or where they stand now. */
export function draftRankOf(
	member: Pick<WorkspaceMember, "rolePreset">,
	roles: readonly WorkspaceRoleDef[],
	roleId: string,
): WorkspaceRole {
	return roles.find((r) => r.id === roleId)?.basePreset ?? member.rolePreset;
}

/** The capabilities a set of facets ends with. */
function heldOf(facets: readonly PermissionFacet[]): WorkspaceCapability[] {
	return facets.filter((f) => f.effective).map((f) => f.capability);
}

/**
 * Whether a drawer change makes a business member a manager who is not one now — the change
 * `org.update_workspace_member` checks against the cap: a role or a `manage_projects` grant that
 * makes them admin-ranked or a project manager (`isBusinessManagerSeat`). A change that leaves a
 * manager a manager is never refused.
 */
export function changeAddsManager(input: {
	kind: WorkspaceKind;
	member: Pick<WorkspaceMember, "rolePreset">;
	saved: readonly PermissionFacet[];
	draftRank: WorkspaceRole;
	draft: readonly PermissionFacet[];
}): boolean {
	if (input.kind !== "business") return false;
	return !isBusinessManagerSeat(input.member.rolePreset, heldOf(input.saved)) &&
		isBusinessManagerSeat(input.draftRank, heldOf(input.draft));
}

/** What the manager-cap notice may name. */
export interface ManagerCapContext {
	/** The business's name. */
	business?: string;
	/** The plan's manager ceiling (`managers.limit`). */
	limit?: number | null;
	/** The viewer owns the business — they are told plans can't change yet, not to ask the owner. */
	viewerIsOwner?: boolean;
}

/** The manager-cap context a console read gives: the business, its ceiling, whether the viewer owns it. */
export function managerCapContextOf(
	ws: Pick<WorkspaceDetail, "name" | "managers" | "members" | "viewerMemberId">,
): ManagerCapContext {
	return {
		business: ws.name,
		limit: ws.managers?.limit ?? null,
		viewerIsOwner: ws.members.some((m) => m.id === ws.viewerMemberId && m.rolePreset === "owner"),
	};
}

/** The manager-cap notice: what happened, and the way forward the viewer has. */
export interface ManagerCapNotice {
	sentence: string;
	meta: string;
}

/**
 * The manager cap, worded from the refusal map's `entitlement` (Decision #243). "See plans" is
 * withheld — no surface lists Business Pro or changes a business's plan (Decisions #246 FLAG 1,
 * #247 (d)) — so the owner reads that changing plans isn't available yet, anyone else whom to ask.
 */
export function managerCapNotice(ctx: ManagerCapContext): ManagerCapNotice {
	const copy = BUSINESS_REFUSAL_COPY.entitlement;
	return {
		sentence: copy.sentence({
			business: ctx.business,
			entitlement: "business_managers",
			limit: ctx.limit,
		}),
		meta: ctx.viewerIsOwner ? PLANS_UNAVAILABLE : copy.ask({}),
	};
}

/** The manager-cap notice as one line of text (a refusal said in an InlineNotice). */
export function managerCapText(ctx: ManagerCapContext): string {
	const notice = managerCapNotice(ctx);
	return `${notice.sentence} ${notice.meta}`;
}

/**
 * A refusal's manager-cap sentence, by its typed `details` (`PK402` → 402 `{reason: "entitlement",
 * entitlement: "business_managers"}`), or `null` for any other refusal.
 */
export function managerCapRefusal(details: unknown, ctx: ManagerCapContext): string | null {
	return readPlanGateDetails(details)?.entitlement === "business_managers"
		? managerCapText(ctx)
		: null;
}

/** A refused drawer save's sentence: the manager cap in the map's words, else the field's own. */
export function memberSaveRefusal(
	result: { message?: string; errors?: Record<string, string>; details?: unknown },
	ctx: ManagerCapContext,
): string {
	const e = result.errors;
	return managerCapRefusal(result.details, ctx) ?? e?.title ?? e?.reportsTo ?? e?.roleId ??
		e?.granted ?? e?.revoked ?? e?.confirm ?? result.message ?? "Could not save those changes.";
}

/**
 * The overrides a draft can hold at its rank: on a business the billing right lives only on an admin
 * seat, so a draft that moves a member off one drops it — the server would strip it, and refuse a
 * patch that kept it ("the billing right goes only to an admin").
 */
export function overridesAtRank(
	kind: WorkspaceKind,
	draft: OverrideDraft,
	rank: WorkspaceRole,
): OverrideDraft {
	if (kind !== "business" || rank === "admin" || !draft.granted.includes("manage_billing")) {
		return draft;
	}
	return { granted: draft.granted.filter((c) => c !== "manage_billing"), revoked: draft.revoked };
}

/**
 * The owner-reserved rights a draft newly gives a member (Decision #230 (d), #238) — each needs the
 * owner's typed confirmation (`org.fn_assert_reserved_change`). Taking one away needs none.
 */
export function reservedAdded(
	kind: WorkspaceKind,
	saved: readonly PermissionFacet[],
	draft: readonly PermissionFacet[],
): WorkspaceCapability[] {
	const before = new Set(heldOf(saved));
	const after = new Set(heldOf(draft));
	return reservedCapabilities(kind).filter((c) => after.has(c) && !before.has(c));
}

/** What holding each owner-reserved right lets an admin do, as a clause. */
const RESERVED_ACT: Readonly<Partial<Record<WorkspaceCapability, string>>> = {
	withdraw_funds: "move money out of the wallet to a bank account",
	manage_billing: "pay the plan and the invoices and run the business's verification",
	archive_entity: "archive the whole business",
};

/** "a", "a and b", "a, b and c". */
function clauseList(items: readonly string[]): string {
	if (items.length <= 1) return items[0] ?? "";
	return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The warning a reserved grant shows before it is confirmed, or `null` when the draft grants none: a
 * co-owner (the draft holds the owner's whole set on an admin seat — `isCoOwner`) is told so; any
 * other grant says what it lets them do. Only the owner takes it away, and the holder can't pass it on
 * (#238 (b), (c)).
 */
export function reservedGrantWarning(
	name: string,
	added: readonly WorkspaceCapability[],
	coOwner: boolean,
): string | null {
	if (added.length === 0) return null;
	if (coOwner) {
		return `${name} becomes a co-owner: they can withdraw from the wallet, pay the plan and the invoices, and archive the business — everything you can but hand ownership over. Only you can take it away, and they can't pass it on.`;
	}
	const acts = clauseList(added.map((c) => RESERVED_ACT[c] ?? CAPABILITY_LABEL[c].toLowerCase()));
	return `${name} can then ${acts}. Only you can take it away, and they can't pass it on.`;
}

/** Whether a draft's reserved grant makes the member a co-owner (the owner's whole set, admin seat). */
export function becomesCoOwner(
	kind: WorkspaceKind,
	draftRank: WorkspaceRole,
	draft: readonly PermissionFacet[],
): boolean {
	return isCoOwner(kind, draftRank, heldOf(draft));
}

/** The confirmation field's label — what to type, and for what. */
export function confirmLabel(added: readonly WorkspaceCapability[]): string {
	return `Type ${RESERVED_GRANT_CONFIRMATION} to grant ${added.length === 1 ? "it" : "them"}`;
}

/** Whether the typed confirmation is the word the server takes (spaces around it ignored). */
export function confirmAnswered(typed: string): boolean {
	return typed.trim() === RESERVED_GRANT_CONFIRMATION;
}
// #endregion
