import type {
	ButtonNeutralTone,
	ButtonSemanticTone,
	ButtonStructuralTone,
} from "@ui/fields/types/button.ts";
import {
	type BusinessManagers,
	capabilitiesForKind,
	CAPABILITY_LABEL,
	effectivePermissions,
	isBusinessManagerRole,
	isBusinessManagerSeat,
	kindCopy,
	reservedCapabilities,
	roleLabel,
	roleRank,
	rolesForKind,
	type UpsertRoleInput,
	WorkspaceCapability,
	type WorkspaceDetail,
	type WorkspaceInvite,
	type WorkspaceKind,
	type WorkspaceMember,
	type WorkspaceRole,
	type WorkspaceRoleDef,
} from "@projective/types/workspace";
import {
	type CapabilityDomain,
	capabilityGroupsFor,
	conditionalRuleFor,
	isConsequential,
	type PolicyContext,
} from "./capabilities.ts";
import {
	inviteLapsed,
	managerCapContextOf,
	managerCapText,
	sensitiveWarning,
	viewerRankOf,
} from "./members-model.ts";
import { ROLE_TEMPLATES, type RoleTemplate, templatesForKind } from "./role-templates.ts";
import { type ButtonTier, isFilledTier } from "./header-model.ts";

/**
 * roles-model — every rule the Roles module renders, as pure functions (Decision #320, rebuilding
 * Teams work order C3's matrix as a master-detail screen).
 *
 * `WorkspaceRoles.island.tsx` is a binding over this file: which roles the roster lists and under
 * which heading, which role is selected first, what the capability canvas draws for the selected role
 * (its four domains, each capability's line, whether it is on, the rule bounding it, and why it cannot
 * change), how a toggle moves the local draft, what the footer rig's Save writes (and what it refuses
 * before the server would), which actions a role's header offers, what the New role dialog clones
 * from, which ranks the Edit dialog offers, how a name and a description are judged and which buttons
 * each region holds.
 *
 * **The server's refusals, said before the press.** `org.upsert_workspace_role` refuses a role that
 * carries a capability its author does not hold, one that ranks above its author, a business role
 * carrying an owner-reserved right, and any edit of a preset; `org.archive_workspace_role` refuses a
 * role somebody holds or a pending invitation offers. Each refusal here is a LOCK with its sentence —
 * a whole role, one capability row or one action that stays visible and says why — never a control
 * that fails on press. Anything a role already allows may be taken away (the drawer's rule,
 * `capabilityToggleable`). On a business, an edit that would make a role's holders managers past the
 * plan's cap is the same kind of lock (`managerCapLock`, BU7): the server refuses it
 * `PK402 business_managers`.
 *
 * Teams and Businesses share it (Decision #61): the rows are the kind's own capability list
 * (`capabilitiesForKind`, the `fn_kind_capabilities` mirror), and a team-only rule is gated on
 * `kind === "team"`. Pure: no preact, no CSS, no network — `deno test` reads it directly.
 */

// #region Vocabulary
/** The preset a custom role may rank as — never `owner` (ownership moves only by transfer). */
export type CustomRoleBase = UpsertRoleInput["basePreset"];

/** The viewer, as the roles editor judges them. */
export interface RolesViewer {
	kind: WorkspaceKind;
	/** The viewer's server-resolved effective capabilities. */
	caps: readonly WorkspaceCapability[];
	/** `roleRank` of the viewer's seat (a custom role ranks as its base); `0` for no seat. */
	rank: number;
	/** Whether the viewer holds `manage_roles` — without it every role is read-only. */
	canManage: boolean;
}

/** The viewer of a detail projection: their own row's rank and the server-resolved capabilities. */
export function rolesViewerOf(
	ws: Pick<WorkspaceDetail, "kind" | "viewerCapabilities" | "members" | "viewerMemberId">,
): RolesViewer {
	return {
		kind: ws.kind,
		caps: ws.viewerCapabilities,
		rank: viewerRankOf(ws),
		canManage: ws.viewerCapabilities.includes("manage_roles"),
	};
}

/** Whether the viewer may put a capability on a role: they hold it, and it is never a role's. */
export function mayGrantToRole(
	capability: WorkspaceCapability,
	viewer: Pick<RolesViewer, "kind" | "caps">,
): boolean {
	return viewer.caps.includes(capability) &&
		!reservedCapabilities(viewer.kind).includes(capability);
}

/** "View audit log", "View audit log and Archive entity", "A, B and C". */
function labelList(caps: readonly WorkspaceCapability[]): string {
	const labels = caps.map((c) => CAPABILITY_LABEL[c]);
	if (labels.length <= 1) return labels.join("");
	return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/** "3 members", tabular wherever it is drawn. */
export function memberCountText(count: number): string {
	return count === 1 ? "1 member" : `${count} members`;
}
// #endregion

// #region Locks
/**
 * Why a preset's permissions cannot change — every preset, the owner's included. Said once, calmly, over
 * the canvas, where the Clone action that is the way out sits beside it.
 */
export const PRESET_LOCK =
	"Preset roles are fixed, so everyone's baseline stays predictable. Clone it to make a custom role you can change.";

/** Why a custom role that does not rank below the viewer is theirs to read, not to change. */
export const RANK_LOCK =
	"This role doesn't rank below yours, so only someone who outranks it can change it.";

/** Why a viewer without `manage_roles` reads every role and changes none. */
export const VIEW_LOCK =
	"You can read what every role may do. Changing it needs the Change roles permission.";

/** Why the viewer cannot switch on a capability they do not hold themselves. */
export const GRANT_LOCK = "You can't grant a permission you don't hold yourself.";

/** Why a business role never carries an owner-reserved right (Decision #230 (d), #238). */
export const RESERVED_LOCK =
	"Billing, withdrawals and archiving go to a named admin by the owner — never to a role.";

/**
 * Why an editable row waits while a role write (the footer rig's Save, or an archive) is in flight —
 * the screen takes no toggle meanwhile, so the row says so rather than ignoring the press.
 */
export const BUSY_LOCK = "Saving — this can change again once the save lands.";

/**
 * Why a whole role is read-only for the viewer, or `null` when its permissions are theirs to change: a
 * preset is fixed (the server refuses any edit of one), a viewer without `manage_roles` changes no role,
 * and a custom role that does not rank strictly below the viewer — their own rank included — cannot be
 * saved by them (`role: that role does not rank below yours`, `org.fn_assert_role_below`).
 */
export function roleLock(
	role: Pick<WorkspaceRoleDef, "preset" | "basePreset">,
	viewer: Pick<RolesViewer, "rank" | "canManage">,
): string | null {
	if (role.preset) return PRESET_LOCK;
	if (!viewer.canManage) return VIEW_LOCK;
	if (roleRank(role.basePreset) >= viewer.rank) return RANK_LOCK;
	return null;
}

/**
 * Why one capability of an editable custom role cannot change, or `null` when it can. Anything the
 * role allows may be taken away; an off capability may be switched on only when the viewer holds it,
 * and never for a business's owner-reserved rights, which no role may carry. While a role write is in
 * flight (`busy`) every such row waits, with {@link BUSY_LOCK}.
 */
export function cellLock(
	capability: WorkspaceCapability,
	on: boolean,
	viewer: Pick<RolesViewer, "kind" | "caps">,
	busy = false,
): string | null {
	if (busy) return BUSY_LOCK;
	if (on) return null;
	if (reservedCapabilities(viewer.kind).includes(capability)) return RESERVED_LOCK;
	if (!viewer.caps.includes(capability)) return GRANT_LOCK;
	return null;
}
// #endregion

// #region Draft
/** A role's draft: capability lists per custom role id, only for roles the viewer has edited. */
export type RoleDraft = Readonly<Record<string, readonly WorkspaceCapability[]>>;

/** The capabilities a role shows — the draft's when the viewer has edited it. */
export function roleCaps(
	role: Pick<WorkspaceRoleDef, "id" | "capabilities">,
	draft: RoleDraft,
): readonly WorkspaceCapability[] {
	return draft[role.id] ?? role.capabilities;
}

/** A capability list in the SSOT's canonical order, each capability once. */
function canonical(caps: Iterable<WorkspaceCapability>): WorkspaceCapability[] {
	const set = new Set(caps);
	return WorkspaceCapability.options.filter((c) => set.has(c));
}

/** Whether two capability lists hold the same set. */
export function sameCaps(
	a: readonly WorkspaceCapability[],
	b: readonly WorkspaceCapability[],
): boolean {
	const left = new Set(a);
	const right = new Set(b);
	return left.size === right.size && [...left].every((c) => right.has(c));
}

/**
 * The draft after one toggle of a custom role's capability. A toggle that returns the role to its
 * saved capabilities drops it from the draft, so flipping a switch twice leaves nothing to save.
 */
export function toggleRoleCap(
	draft: RoleDraft,
	role: Pick<WorkspaceRoleDef, "id" | "capabilities">,
	capability: WorkspaceCapability,
): RoleDraft {
	const current = new Set(roleCaps(role, draft));
	if (current.has(capability)) current.delete(capability);
	else current.add(capability);
	const next = canonical(current);
	const { [role.id]: _previous, ...rest } = draft;
	return sameCaps(next, role.capabilities) ? rest : { ...rest, [role.id]: next };
}

/** The custom roles whose draft differs from what is saved, in the roles' order. */
export function dirtyRoleIds(roles: readonly WorkspaceRoleDef[], draft: RoleDraft): string[] {
	return roles
		.filter((r) => r.preset === null && draft[r.id] && !sameCaps(draft[r.id], r.capabilities))
		.map((r) => r.id);
}

/** The draft with every role the latest detail no longer carries (archived, gone) dropped. */
export function pruneDraft(draft: RoleDraft, roles: readonly WorkspaceRoleDef[]): RoleDraft {
	const live = new Set(dirtyRoleIds(roles, draft));
	return Object.fromEntries(Object.entries(draft).filter(([id]) => live.has(id)));
}
// #endregion

// #region Roster (the master pane)
/** Presets first, most- to least-privileged, then the custom roles in the server's order. */
export function orderedRoles(roles: readonly WorkspaceRoleDef[]): WorkspaceRoleDef[] {
	const presets = roles.filter((r) => r.preset !== null)
		.sort((a, b) => roleRank(b.preset ?? "member") - roleRank(a.preset ?? "member"));
	return [...presets, ...roles.filter((r) => r.preset === null)];
}

/** What a role allows on a kind: the owner holds everything the kind renders. */
function heldOnKind(
	role: Pick<WorkspaceRoleDef, "preset" | "capabilities">,
	caps: readonly WorkspaceCapability[],
	kind: WorkspaceKind,
): WorkspaceCapability[] {
	const rows = capabilitiesForKind(kind);
	return role.preset === "owner" ? rows : rows.filter((c) => caps.includes(c));
}

/** "invite members" — a capability label read inside a sentence. */
function inSentence(capability: WorkspaceCapability): string {
	const label = CAPABILITY_LABEL[capability];
	return label.charAt(0).toLowerCase() + label.slice(1);
}

/**
 * A role's one-sentence remit: its written summary, else a sentence read off what it allows — "Can
 * invite members, manage projects and 3 more." — so a custom role created without a description still
 * says something true under its name.
 */
export function roleSummaryLine(
	role: Pick<WorkspaceRoleDef, "summary" | "preset" | "capabilities">,
	kind: WorkspaceKind,
): string {
	const written = role.summary.trim();
	if (written !== "") return written;
	const held = heldOnKind(role, role.capabilities, kind);
	if (held.length === 0) return "No permissions yet — a seat and nothing more.";
	const named = held.slice(0, 2).map(inSentence);
	const rest = held.length - named.length;
	if (rest === 0) return `Can ${named.join(" and ")}.`;
	return `Can ${named.join(", ")} and ${rest} more.`;
}

/** One row of the roster. */
export interface RosterRow {
	id: string;
	name: string;
	/** The preset this row IS, or `null` for a custom role. */
	preset: WorkspaceRole | null;
	memberCount: number;
	/** {@link memberCountText} — the count's accessible name. */
	countText: string;
	/** Whether the role holds unsaved permission changes. */
	edited: boolean;
}

/** One headed run of the roster. */
export interface RosterSection {
	key: "preset" | "custom";
	title: string;
	rows: RosterRow[];
	/** What an empty run says, or `null` for a run that is never empty. */
	empty: string | null;
}

/** What the Custom roles run says while the entity has none. */
export const CUSTOM_EMPTY = "None yet.";

/**
 * The roster: **Preset roles** (most-privileged first) over **Custom roles** (the server's order). Each
 * row is the role's name, its holders' count and whether it holds unsaved changes — its remit is the
 * canvas's to say (Decision #321); the custom run says "None yet." while it is empty, so the heading
 * never sits over nothing.
 */
export function rosterSections(
	roles: readonly WorkspaceRoleDef[],
	draft: RoleDraft,
): RosterSection[] {
	const edited = new Set(dirtyRoleIds(roles, draft));
	const row = (role: WorkspaceRoleDef): RosterRow => ({
		id: role.id,
		name: role.name,
		preset: role.preset,
		memberCount: role.memberCount,
		countText: memberCountText(role.memberCount),
		edited: edited.has(role.id),
	});
	const ordered = orderedRoles(roles);
	return [
		{
			key: "preset",
			title: "Preset roles",
			rows: ordered.filter((r) => r.preset !== null).map(row),
			empty: null,
		},
		{
			key: "custom",
			title: "Custom roles",
			rows: ordered.filter((r) => r.preset === null).map(row),
			empty: CUSTOM_EMPTY,
		},
	];
}

/**
 * The role the screen opens on: the first custom role — the ones a reader comes here to change — else
 * the first preset below the owner (whose canvas is simply everything), else whatever there is.
 */
export function initialRoleId(roles: readonly WorkspaceRoleDef[]): string | null {
	const ordered = orderedRoles(roles);
	return (ordered.find((r) => r.preset === null) ??
		ordered.find((r) => r.preset !== null && r.preset !== "owner") ??
		ordered[0])?.id ?? null;
}

/** The selection after the roles changed: the same role while it still exists, else the opening one. */
export function keepSelection(
	roles: readonly Pick<WorkspaceRoleDef, "id">[],
	current: string | null,
	fallback: () => string | null,
): string | null {
	return current !== null && roles.some((r) => r.id === current) ? current : fallback();
}

/** The role a write created: the one id the re-read detail has that the previous one did not. */
export function createdRoleId(
	before: readonly Pick<WorkspaceRoleDef, "id">[],
	after: readonly Pick<WorkspaceRoleDef, "id">[],
): string | null {
	const known = new Set(before.map((r) => r.id));
	return after.find((r) => !known.has(r.id))?.id ?? null;
}
// #endregion

// #region Canvas (the detail pane)
/**
 * What a capability lets its holder do, in one line (meta register). A consequential capability says
 * its consequence instead — the member drawer's `sensitiveWarning`, the same sentence on both surfaces —
 * since that is the line a reader most needs before switching it on.
 */
export function capabilityLine(capability: WorkspaceCapability, kind: WorkspaceKind): string {
	const warning = sensitiveWarning(capability, kind);
	if (warning) return warning;
	const copy = kindCopy(kind);
	switch (capability) {
		case "invite_members":
			return `Invites people to the ${copy.noun} and approves requests to join.`;
		case "remove_members":
			return `Removes people from the ${copy.noun}.`;
		case "edit_profile":
			return `Edits the ${copy.noun}'s public profile — name, story, logo and banner.`;
		case "manage_settings":
			return `Changes the ${copy.noun}'s settings.`;
		case "manage_projects":
			return kind === "team"
				? "Creates the team's projects and runs their stages."
				: "Creates projects billed to the business and runs their stages.";
		case "publish_listings":
			return "Publishes and edits the team's catalogue listings.";
		case "purchase":
			return "Buys services and assets for the business.";
		case "hire":
			return "Hires freelancers and teams, and approves the work they deliver.";
		case "contribute_funds":
			return `Adds money to the ${copy.moneyNoun}.`;
		case "manage_finances":
			return kind === "team"
				? "Sets how earnings are split and reads the vault's figures."
				: "Sets spending limits and the wallet's policy.";
		case "view_analytics":
			return `Reads the ${copy.noun}'s analytics and standing.`;
		case "view_audit":
			return "Reads the log of who changed what, and when.";
		default:
			return CAPABILITY_LABEL[capability];
	}
}

/** One capability row of the canvas. */
export interface CanvasRow {
	capability: WorkspaceCapability;
	label: string;
	/** {@link capabilityLine}. */
	description: string;
	/** Whether the role allows it (the switch's value) — the draft's when the viewer has edited it. */
	on: boolean;
	/** A consequential capability (`CONSEQUENTIAL`) — flagged beside its label. */
	sensitive: boolean;
	/** The configured rule bounding it while it is on (`conditionalRuleFor`), else `null`. */
	rule: string | null;
	/**
	 * Why this one row cannot change on a role the viewer may otherwise edit (a grant they do not hold,
	 * an owner-reserved right, the manager cap), else `null`. A whole-role lock is the canvas's
	 * {@link RoleCanvas.lock}, said once, never repeated on every row.
	 */
	lock: string | null;
}

/** One domain of the canvas. */
export interface CanvasDomain {
	key: CapabilityDomain;
	title: string;
	description: string;
	rows: CanvasRow[];
	/** How many of its rows are on. */
	allowed: number;
}

/** What the canvas draws for the selected role. */
export interface RoleCanvas {
	/** {@link roleLock}: why the whole role is read-only, or `null` when its switches are live. */
	lock: string | null;
	domains: CanvasDomain[];
	/** How many capabilities the role allows, of how many the kind renders. */
	allowed: number;
	total: number;
	/** Whether any row is locked by a business's manager cap — the canvas then says the cap once. */
	capped: boolean;
}

/**
 * The capability canvas for one role: the kind's domains, every capability with its line, whether the
 * role allows it (the owner holds everything), the rule bounding it while on — never on the owner's,
 * whose authority no configured rule narrows on this screen (#264 (f)) — and, on a role the viewer may
 * edit, why a row cannot change.
 */
export function roleCanvas(input: {
	role: WorkspaceRoleDef;
	roles: readonly WorkspaceRoleDef[];
	draft: RoleDraft;
	viewer: RolesViewer;
	policy: PolicyContext;
	cap: RoleCapContext;
}): RoleCanvas {
	const { role, roles, draft, viewer, policy, cap } = input;
	const lock = roleLock(role, viewer);
	const held = new Set(heldOnKind(role, roleCaps(role, draft), viewer.kind));
	let capped = false;
	const domains = capabilityGroupsFor(viewer.kind).map((group): CanvasDomain => {
		const rows = group.capabilities.map((capability): CanvasRow => {
			const on = held.has(capability);
			const rowLock = lock !== null ? null : cellLock(capability, on, viewer) ??
				managerCapLock(role, capability, on, roles, draft, cap);
			if (rowLock !== null && rowLock === cap.text) capped = true;
			return {
				capability,
				label: CAPABILITY_LABEL[capability],
				description: capabilityLine(capability, viewer.kind),
				on,
				sensitive: isConsequential(capability),
				rule: on && role.preset !== "owner" ? conditionalRuleFor(capability, policy) : null,
				lock: rowLock,
			};
		});
		return {
			key: group.key,
			title: group.title,
			description: group.description,
			rows,
			allowed: rows.filter((r) => r.on).length,
		};
	});
	return {
		lock,
		domains,
		allowed: held.size,
		total: capabilitiesForKind(viewer.kind).length,
		capped,
	};
}

/** "12 of 17 permissions" — a domain's or a role's count. */
export function allowedText(allowed: number, total: number): string {
	return `${allowed} of ${total} ${total === 1 ? "permission" : "permissions"}`;
}

/**
 * The canvas header's meta line: what kind of role it is (and, for a custom role, the preset it ranks
 * as), who holds it, how much it allows, and "Unsaved changes" while the draft holds edits to it.
 */
export function canvasMeta(
	role: Pick<WorkspaceRoleDef, "preset" | "basePreset" | "memberCount">,
	canvas: Pick<RoleCanvas, "allowed" | "total">,
	edited: boolean,
): string[] {
	return [
		role.preset ? "Preset role" : `Custom role · ranks as ${roleLabel(role.basePreset)}`,
		memberCountText(role.memberCount),
		allowedText(canvas.allowed, canvas.total),
		...(edited ? ["Unsaved changes"] : []),
	];
}
// #endregion

// #region Manager cap (BU7)
/**
 * What a business's manager cap needs from the console read to judge a role edit before the press
 * (Decision #230 (b), #249): the headroom, who holds which role, and the invitations offering each.
 */
export interface RoleCapContext {
	kind: WorkspaceKind;
	/** The headroom (`WorkspaceDetail.managers`) — `null` for a team. */
	managers: BusinessManagers | null;
	/** Every member, for whose seat a role edit starts or stops counting. */
	members: readonly Pick<WorkspaceMember, "roleId" | "rolePreset" | "state" | "overrides">[];
	/**
	 * The outgoing queue, when the viewer reads it (`invite_members`): its unexpired invitations are
	 * what the cap counts. Without it the role's own `pendingInvites` count stands in.
	 */
	queue: readonly WorkspaceInvite[] | null;
	/** Epoch ms the queue's windows are judged at. */
	now: number;
	/** The cap's sentence, as the refusal map words it (`managerCapText`). */
	text: string;
}

/** The manager-cap context a console read gives, judged at `now` (epoch ms). */
export function roleCapContextOf(ws: WorkspaceDetail, now: number): RoleCapContext {
	return {
		kind: ws.kind,
		managers: ws.managers ?? null,
		members: ws.members,
		queue: ws.viewerCapabilities.includes("invite_members") ? ws.invites : null,
		now,
		text: managerCapText(managerCapContextOf(ws)),
	};
}

/** The ceiling a role edit is judged against, or `null` while nothing caps managers (or a team). */
function capLimit(ctx: Pick<RoleCapContext, "kind" | "managers">): number | null {
	return ctx.kind === "business" ? ctx.managers?.limit ?? null : null;
}

/** How many invitations offering a role the cap counts: the queue's unexpired ones, else the count. */
function offeredSeats(
	role: Pick<WorkspaceRoleDef, "id" | "pendingInvites">,
	ctx: Pick<RoleCapContext, "queue" | "now">,
): number {
	if (ctx.queue) {
		return ctx.queue.filter((i) => i.roleId === role.id && !inviteLapsed(i, ctx.now)).length;
	}
	return role.pendingInvites ?? 0;
}

/**
 * How many manager seats saving a business role with `caps` — and, when its rank changes, as
 * `basePreset` — takes; negative when it frees some. It is the count `org.upsert_workspace_role`
 * compares before and after the edit (`finance.fn_footprint_usage('business_managers')`): each active
 * holder whose seat starts or stops counting (`isBusinessManagerSeat` over the role's rank and their own
 * grants and revocations), and the invitations offering the role when the role itself starts or stops
 * being a manager's (`isBusinessManagerRole`). A team's edit takes none.
 */
export function managerDelta(
	role: WorkspaceRoleDef,
	caps: readonly WorkspaceCapability[],
	ctx: Pick<RoleCapContext, "kind" | "members" | "queue" | "now">,
	basePreset: WorkspaceRole = role.basePreset,
): number {
	if (ctx.kind !== "business") return 0;
	const before: WorkspaceRoleDef[] = [role];
	const after: WorkspaceRoleDef[] = [{ ...role, basePreset, capabilities: [...caps] }];
	let delta = 0;
	for (const m of ctx.members) {
		if (m.roleId !== role.id || m.state !== "active") continue;
		const was = isBusinessManagerSeat(
			m.rolePreset,
			effectivePermissions(m, "business", before, role.id),
		);
		const is = isBusinessManagerSeat(
			basePreset === role.basePreset ? m.rolePreset : basePreset,
			effectivePermissions(m, "business", after, role.id),
		);
		delta += Number(is) - Number(was);
	}
	const wasRole = isBusinessManagerRole(role);
	const isRole = isBusinessManagerRole({ basePreset, capabilities: caps });
	if (wasRole !== isRole) delta += (isRole ? 1 : -1) * offeredSeats(role, ctx);
	return delta;
}

/**
 * The managers the draft would leave counted once every edited role is saved — the headroom's `used`
 * plus each dirty role's {@link managerDelta} — or `null` while nothing caps them.
 */
export function draftManagersUsed(
	roles: readonly WorkspaceRoleDef[],
	draft: RoleDraft,
	ctx: RoleCapContext,
): number | null {
	if (capLimit(ctx) === null || !ctx.managers) return null;
	let used = ctx.managers.used;
	for (const id of dirtyRoleIds(roles, draft)) {
		const role = roles.find((r) => r.id === id);
		if (role) used += managerDelta(role, canonical(draft[id]), ctx);
	}
	return used;
}

/**
 * Why switching an off capability on would pass a business's manager cap, or `null`. The server
 * refuses a role edit that ADDS managers past the plan's ceiling, so the switch that would do it — in
 * practice Manage projects on a member-ranked role somebody holds or is offered — is locked with the
 * cap's sentence while the rest of the draft stands. Anything a role allows may still be taken away,
 * and a toggle that adds no manager (nobody holds the role) is never locked.
 */
export function managerCapLock(
	role: WorkspaceRoleDef,
	capability: WorkspaceCapability,
	on: boolean,
	roles: readonly WorkspaceRoleDef[],
	draft: RoleDraft,
	ctx: RoleCapContext,
): string | null {
	const limit = capLimit(ctx);
	if (on || limit === null || role.preset) return null;
	const before = draftManagersUsed(roles, draft, ctx) ?? 0;
	const after = draftManagersUsed(roles, toggleRoleCap(draft, role, capability), ctx) ?? 0;
	return after > before && after > limit ? ctx.text : null;
}

/** A role held back by the manager cap: how many managers it would add, then the cap's sentence. */
export function managerCapLine(
	name: string,
	added: number,
	cap: Pick<RoleCapContext, "text">,
): string {
	return `Saving ${name} would add ${added} ${added === 1 ? "manager" : "managers"}. ${cap.text}`;
}

/**
 * Why re-ranking a saved business role would pass the manager cap, or `null` — the Edit dialog's
 * Ranks as field, judged as the server judges the write (an admin rank makes every holder a manager).
 */
export function rankCapProblem(
	role: WorkspaceRoleDef,
	basePreset: WorkspaceRole,
	ctx: RoleCapContext,
): string | null {
	const limit = capLimit(ctx);
	if (limit === null || !ctx.managers || basePreset === role.basePreset) return null;
	const delta = managerDelta(role, role.capabilities, ctx, basePreset);
	return delta > 0 && ctx.managers.used + delta > limit
		? managerCapLine(role.name, delta, ctx)
		: null;
}
// #endregion

// #region Save
/** One role write the footer rig's Save sends. */
export interface RoleWrite {
	role: WorkspaceRoleDef;
	capabilities: WorkspaceCapability[];
}

/** A dirty role the server would refuse, and the sentence that says so before it is asked. */
export interface RoleSaveProblem {
	roleId: string;
	text: string;
}

/** What one press of Save does: the writes it sends and the roles it holds back. */
export interface RoleSavePlan {
	writes: RoleWrite[];
	problems: RoleSaveProblem[];
}

/**
 * The footer rig's Save over the draft. Every dirty custom role is one write — unless it still allows
 * something the viewer may not put on a role (a capability they lack, or a business's reserved right
 * a legacy role carries), which the server refuses for the whole role; that role is held back with
 * the sentence naming what to switch off, and the others still save.
 *
 * On a business (`cap`), the writes are judged in Save's order against the manager cap the way the
 * server judges each one: a write that adds managers ({@link managerDelta}) past the plan's ceiling is
 * held back with the cap's sentence ({@link managerCapLine}); one that frees seats leaves them to the
 * writes after it.
 */
export function roleSavePlan(
	roles: readonly WorkspaceRoleDef[],
	draft: RoleDraft,
	viewer: Pick<RolesViewer, "kind" | "caps">,
	cap?: RoleCapContext,
): RoleSavePlan {
	const plan: RoleSavePlan = { writes: [], problems: [] };
	const limit = cap ? capLimit(cap) : null;
	let used = cap?.managers?.used ?? 0;
	for (const id of dirtyRoleIds(roles, draft)) {
		const role = roles.find((r) => r.id === id);
		if (!role) continue;
		const capabilities = canonical(draft[id]);
		const blocked = capabilities.filter((c) => !mayGrantToRole(c, viewer));
		if (blocked.length > 0) {
			plan.problems.push({
				roleId: id,
				text: `${role.name} still allows ${labelList(blocked)}, which you can't give a role — ` +
					`switch ${blocked.length === 1 ? "it" : "them"} off to save it.`,
			});
			continue;
		}
		const delta = cap ? managerDelta(role, capabilities, cap) : 0;
		if (cap && limit !== null && delta > 0 && used + delta > limit) {
			plan.problems.push({ roleId: id, text: managerCapLine(role.name, delta, cap) });
			continue;
		}
		used += delta;
		plan.writes.push({ role, capabilities });
	}
	return plan;
}

/** The custom-role write for a role's new capabilities, keeping its name, summary and rank. */
export function roleWriteInput(
	ws: Pick<WorkspaceDetail, "kind" | "id">,
	write: RoleWrite,
): UpsertRoleInput {
	return {
		kind: ws.kind,
		workspaceId: ws.id,
		roleId: write.role.id,
		name: write.role.name,
		summary: write.role.summary,
		capabilities: write.capabilities,
		basePreset: asCustomBase(write.role.basePreset),
	};
}
// #endregion

// #region Role actions (the canvas header)
/** What a custom role's header can ask for. */
export type RoleActionKey = "edit" | "duplicate" | "archive";

/** How many pending invitations in an outgoing queue offer a role. */
export function invitesOffering(roleId: string, invites: readonly WorkspaceInvite[]): number {
	return invites.filter((i) => i.roleId === roleId).length;
}

/**
 * How many pending invitations offer a role, as the archive door counts them: the detail's own
 * per-role count (`pendingInvites`, answered to every `manage_roles` holder — the outgoing queue is
 * `invite_members`' alone, so a role manager without it would read an empty queue), else the queue.
 */
export function pendingInvitesFor(
	role: Pick<WorkspaceRoleDef, "id" | "pendingInvites">,
	invites: readonly WorkspaceInvite[],
): number {
	return role.pendingInvites ?? invitesOffering(role.id, invites);
}

/**
 * Why a custom role cannot be archived yet, with the count, or `null` when it can — the two refusals
 * `org.archive_workspace_role` makes: somebody holds it, or a pending invitation offers it.
 */
export function archiveBlock(
	role: Pick<WorkspaceRoleDef, "memberCount">,
	offeredBy: number,
): string | null {
	if (role.memberCount > 0) {
		return `${memberCountText(role.memberCount)} ${
			role.memberCount === 1 ? "holds" : "hold"
		} this role — move ${role.memberCount === 1 ? "them" : "them all"} to another role first.`;
	}
	if (offeredBy > 0) {
		return `${
			offeredBy === 1 ? "A pending invitation offers" : `${offeredBy} pending invitations offer`
		}` +
			` this role — withdraw ${offeredBy === 1 ? "it" : "them"} first.`;
	}
	return null;
}

/** What the Archive action's line says when nothing refuses it. */
export const ARCHIVE_HINT = "Kept on record, never deleted.";

/**
 * The short form of an archive refusal — the count and its remedy — or, when nothing refuses it,
 * {@link ARCHIVE_HINT}. The full sentence ({@link archiveBlock}) is the action's description.
 */
export function archiveHint(
	role: Pick<WorkspaceRoleDef, "memberCount">,
	offeredBy: number,
): string {
	if (role.memberCount > 0) {
		return `${memberCountText(role.memberCount)} ${
			role.memberCount === 1 ? "holds" : "hold"
		} it — move them first.`;
	}
	if (offeredBy > 0) {
		return `${
			offeredBy === 1 ? "A pending invitation offers" : `${offeredBy} pending invitations offer`
		} it.`;
	}
	return ARCHIVE_HINT;
}

/** The short form of an edit refusal ({@link editBlock}). */
export const EDIT_BLOCKED_HINT = "It allows what you can't grant.";

/**
 * Why the viewer cannot edit a role's details though they may otherwise change it, or `null`: an edit
 * re-writes the role's saved capabilities, so one that still allows something the viewer may not put
 * on a role is refused whole by the server.
 */
export function editBlock(
	role: Pick<WorkspaceRoleDef, "name" | "capabilities">,
	viewer: Pick<RolesViewer, "kind" | "caps">,
): string | null {
	const blocked = role.capabilities.filter((c) => !mayGrantToRole(c, viewer));
	return blocked.length === 0
		? null
		: `${role.name} allows ${labelList(blocked)}, which you can't give a role.`;
}

/** One action of a role's header, before it is bound to the screen. */
export interface RoleActionRow {
	action: RoleActionKey;
	/** Why the action is refused — said beside it and as its description — or `null` when it acts. */
	disabledReason: string | null;
	/** The refusal's short form, or `null` for none. */
	hint: string | null;
}

/**
 * The actions a custom role's header offers, in order — none on a preset (its canvas notice offers
 * Clone instead) and none without `manage_roles`. Edit details only on a role the viewer may change,
 * refused in place when the role carries what they cannot grant; Duplicate always; Archive always,
 * refused in place while anybody holds the role or an invitation offers it ({@link pendingInvitesFor})
 * — never hidden, so the reader learns why.
 */
export function roleActionRows(
	role: WorkspaceRoleDef,
	viewer: RolesViewer,
	invites: readonly WorkspaceInvite[],
): RoleActionRow[] {
	if (!viewer.canManage || role.preset) return [];
	const rows: RoleActionRow[] = [];
	if (roleLock(role, viewer) === null) {
		const blocked = editBlock(role, viewer);
		rows.push({
			action: "edit",
			disabledReason: blocked,
			hint: blocked ? EDIT_BLOCKED_HINT : null,
		});
	}
	rows.push({ action: "duplicate", disabledReason: null, hint: null });
	const offered = pendingInvitesFor(role, invites);
	const blocked = archiveBlock(role, offered);
	rows.push({
		action: "archive",
		disabledReason: blocked,
		hint: blocked ? archiveHint(role, offered) : null,
	});
	return rows;
}
// #endregion

// #region Role dialogs
/** Which run of the Clone from list a starting point sits in. */
export type StartGroup = "start" | "template" | "preset" | "custom";

/** Where a new role starts: a clean slate, a template, or a copy of an existing role. */
export interface StartPoint {
	/** The option value: `blank`, `template:<key>` or `role:<id>`. */
	key: string;
	group: StartGroup;
	/** The option's label. */
	label: string;
	/** What it carries, as the option's second line. */
	description: string;
	/** The name it suggests ("" for nothing). */
	name: string;
	/** The description it suggests. */
	summary: string;
	/** The rank it suggests (clamped to what the author may create by {@link clampBase}). */
	basePreset: WorkspaceRole;
	/** Its capabilities, before {@link seedFrom} filters them to what the author may grant. */
	capabilities: readonly WorkspaceCapability[];
}

/** The starting point that carries nothing — the dialog's default. */
export const BLANK_START = "blank";

/** "View analytics, Invite members." — or a sentence when there is nothing. */
function capsDescription(caps: readonly WorkspaceCapability[]): string {
	return caps.length === 0
		? "No permissions."
		: `${caps.map((c) => CAPABILITY_LABEL[c]).join(", ")}.`;
}

/**
 * Every starting point the New role dialog's ONE "Clone permissions from" field offers, in order: a
 * clean slate, then the kind's templates (data — `role-templates.ts`), then each existing role, presets
 * first. Cloning is how a preset is "edited": the preset stays fixed, and its clone is a custom role the
 * author owns. The clone also brings its rank (who may manage the role's holders), so the dialog asks
 * nothing more; Edit details changes the rank later.
 */
export function startPoints(
	kind: WorkspaceKind,
	roles: readonly WorkspaceRoleDef[],
	templates: readonly RoleTemplate[] = ROLE_TEMPLATES,
): StartPoint[] {
	const allowed = new Set(capabilitiesForKind(kind));
	const inKind = (caps: readonly WorkspaceCapability[]) => caps.filter((c) => allowed.has(c));
	return [
		{
			key: BLANK_START,
			group: "start",
			label: "None — clean slate",
			description: "No permissions; ranks as Member.",
			name: "",
			summary: "",
			basePreset: "member",
			capabilities: [],
		},
		...templatesForKind(kind, templates).map((t): StartPoint => ({
			key: `template:${t.key}`,
			group: "template",
			label: `${t.name} template`,
			description: capsDescription(inKind(t.capabilities)),
			name: t.name,
			summary: t.summary,
			basePreset: t.basePreset,
			capabilities: inKind(t.capabilities),
		})),
		...orderedRoles(roles).map((r): StartPoint => {
			const caps = inKind(r.preset === "owner" ? capabilitiesForKind(kind) : r.capabilities);
			return {
				key: `role:${r.id}`,
				group: r.preset ? "preset" : "custom",
				label: r.name,
				description: capsDescription(caps),
				name: `${r.name} copy`,
				summary: r.summary,
				basePreset: r.basePreset,
				capabilities: caps,
			};
		}),
	];
}

/** The starting point a key names, or the blank one. */
export function startPointOf(points: readonly StartPoint[], key: string | null): StartPoint {
	return points.find((p) => p.key === key) ?? points[0];
}

/** One option of the Clone from field (the ui `Option` shape). */
export interface CloneOption {
	value: string;
	label: string;
	description: string;
}

/** One headed run of the Clone from field (the ui `OptionGroup` shape). */
export interface CloneOptionGroup {
	label: string;
	items: CloneOption[];
}

/** The Clone from field's options, in headed runs — a run with nothing in it is left out. */
export function cloneOptionGroups(points: readonly StartPoint[]): CloneOptionGroup[] {
	const runs: { group: StartGroup; label: string }[] = [
		{ group: "start", label: "Start" },
		{ group: "template", label: "Templates" },
		{ group: "preset", label: "Preset roles" },
		{ group: "custom", label: "Custom roles" },
	];
	return runs
		.map((run) => ({
			label: run.label,
			items: points.filter((p) => p.group === run.group).map((p) => ({
				value: p.key,
				label: p.label,
				description: p.description,
			})),
		}))
		.filter((run) => run.items.length > 0);
}

/** The `owner` rank folds to `admin` — the highest a custom role may name. */
function asCustomBase(role: WorkspaceRole): CustomRoleBase {
	return role === "owner" ? "admin" : role;
}

/**
 * The ranks a custom role may take: the kind's presets (no `lead` on a business), never `owner`, and
 * only below the author's own rank — `org.fn_assert_role_below` refuses the author's rank and above,
 * so they are not offered. Most-privileged first.
 */
export function baseOptions(kind: WorkspaceKind, viewerRank: number): CustomRoleBase[] {
	return rolesForKind(kind).filter((r): r is CustomRoleBase =>
		r !== "owner" && roleRank(r) < viewerRank
	);
}

/**
 * The rank to start on: the one wanted when it is offered, else the highest offered rank below it,
 * else `member` (which the server will refuse for an author without a seat, with its own sentence).
 */
export function clampBase(
	wanted: WorkspaceRole,
	offered: readonly CustomRoleBase[],
): CustomRoleBase {
	const target = asCustomBase(wanted);
	if (offered.includes(target)) return target;
	return offered.find((r) => roleRank(r) <= roleRank(target)) ?? offered.at(-1) ?? "member";
}

/** What the dialog starts a new role with. */
export interface RoleSeed {
	/** The capabilities the new role is written with — only what the author may grant. */
	capabilities: WorkspaceCapability[];
	/** The starting point's capabilities left out, because the author may not put them on a role. */
	dropped: WorkspaceCapability[];
	basePreset: CustomRoleBase;
}

/** Seed a new role from a starting point, filtered to what the author may grant and create. */
export function seedFrom(
	start: Pick<StartPoint, "capabilities" | "basePreset">,
	viewer: Pick<RolesViewer, "kind" | "caps" | "rank">,
): RoleSeed {
	const caps = canonical(start.capabilities);
	return {
		capabilities: caps.filter((c) => mayGrantToRole(c, viewer)),
		dropped: caps.filter((c) => !mayGrantToRole(c, viewer)),
		basePreset: clampBase(start.basePreset, baseOptions(viewer.kind, viewer.rank)),
	};
}

/** The dialog's line about what a clone lost on the way in, or `null` when it lost nothing. */
export function seedNote(
	dropped: readonly WorkspaceCapability[],
	kind: WorkspaceKind,
): string | null {
	if (dropped.length === 0) return null;
	const reserved = dropped.filter((c) => reservedCapabilities(kind).includes(c));
	const lacking = dropped.filter((c) => !reserved.includes(c));
	const parts: string[] = [];
	if (lacking.length > 0) {
		parts.push(
			`${labelList(lacking)} ${
				lacking.length === 1 ? "is" : "are"
			} left out — you can't grant what you don't hold.`,
		);
	}
	if (reserved.length > 0) {
		parts.push(
			`${labelList(reserved)} ${reserved.length === 1 ? "is" : "are"} left out — the owner gives ${
				reserved.length === 1 ? "it" : "them"
			} to a named admin, never to a role.`,
		);
	}
	return parts.join(" ");
}

/**
 * The example the Name field shows, per kind — a role that kind really has: a business's buyer-side
 * Purchaser rides `purchase`, a right no team ever holds (`BUSINESS_ONLY`), so a team suggests a
 * delivery role instead.
 */
export const ROLE_NAME_EXAMPLE: Readonly<Record<WorkspaceKind, string>> = {
	team: "Designer",
	business: "Purchaser",
};

/** "View analytics", "A, B and C" — or, past three, a count ("9 permissions"). */
function startsWith(caps: readonly WorkspaceCapability[]): string {
	return caps.length <= 3 ? labelList(caps) : `${caps.length} permissions`;
}

/** Which job a role dialog is doing. */
export type RoleEditorMode = "create" | "edit";

/**
 * The dialog's opening line. Creating, it follows the clone source: a role that starts with nothing is
 * told to switch on what it may do once it exists; one a template or a clone seeded says what it
 * starts with. Editing keeps the permissions and the people holding it.
 */
export function roleEditorIntro(
	mode: RoleEditorMode,
	kind: WorkspaceKind,
	seeded: readonly WorkspaceCapability[],
): string {
	if (mode === "edit") return "Its permissions and the people holding it stay as they are.";
	const lead = `A custom role is a named set of permissions for this ${kindCopy(kind).noun}.`;
	return seeded.length === 0
		? `${lead} Switch on what it may do once it exists.`
		: `${lead} It starts with ${startsWith(seeded)} — change any of it afterwards.`;
}

/** The Clone from field's hint for the chosen source: what the new role starts with, and its rank. */
export function cloneHint(seed: Pick<RoleSeed, "capabilities" | "basePreset">): string {
	const rank = roleLabel(seed.basePreset);
	return seed.capabilities.length === 0
		? `Starts with no permissions and ranks as ${rank}.`
		: `Starts with ${startsWith(seed.capabilities)} and ranks as ${rank}. Change either later.`;
}

/** What the screen says once the dialog created a role, by what the role was created with. */
export function roleCreatedNotice(name: string, caps: readonly WorkspaceCapability[]): string {
	return caps.length === 0 ? `${name} created` : `${name} created with ${startsWith(caps)}`;
}

/** The longest role name the database takes (`WorkspaceRoleDef.name`). */
export const ROLE_NAME_MAX = 48;

/** The longest description the database takes (`WorkspaceRoleDef.summary`). */
export const ROLE_SUMMARY_MAX = 160;

/**
 * What is wrong with a role name, or `null`: it is required, at most {@link ROLE_NAME_MAX}
 * characters once trimmed, and unique among the entity's live roles ignoring case — the mirror of
 * `uq_team_roles_name` / `uq_business_roles_name` on `lower(name)`.
 */
export function roleNameProblem(
	name: string,
	roles: readonly Pick<WorkspaceRoleDef, "id" | "name">[],
	exceptId: string | null = null,
): string | null {
	const trimmed = name.trim();
	if (trimmed.length === 0) return "Give the role a name.";
	if (trimmed.length > ROLE_NAME_MAX) return `Keep the name to ${ROLE_NAME_MAX} characters.`;
	const clash = roles.find((r) =>
		r.id !== exceptId && r.name.trim().toLowerCase() === trimmed.toLowerCase()
	);
	return clash ? `There is already a role called ${clash.name}.` : null;
}

/** What is wrong with a role description, or `null`: optional, at most {@link ROLE_SUMMARY_MAX}. */
export function roleSummaryProblem(summary: string): string | null {
	return summary.trim().length > ROLE_SUMMARY_MAX
		? `Keep the description to ${ROLE_SUMMARY_MAX} characters.`
		: null;
}

/** The custom-role write a dialog sends. */
export function roleEditorInput(
	ws: Pick<WorkspaceDetail, "kind" | "id">,
	input: {
		mode: RoleEditorMode;
		name: string;
		summary: string;
		basePreset: CustomRoleBase;
		/** Create: the seed's capabilities. */
		seed?: { capabilities: readonly WorkspaceCapability[] };
		/** Edit: the role being edited, whose saved capabilities are kept. */
		role?: WorkspaceRoleDef;
	},
): UpsertRoleInput {
	const base = {
		kind: ws.kind,
		workspaceId: ws.id,
		name: input.name.trim(),
		summary: input.summary.trim(),
		basePreset: input.basePreset,
	};
	if (input.mode === "edit" && input.role) {
		return { ...base, roleId: input.role.id, capabilities: [...input.role.capabilities] };
	}
	return { ...base, capabilities: [...(input.seed?.capabilities ?? [])] };
}
// #endregion

// #region Buttons
/** A button's place on the Interaction Matrix (§B.8.1) on the Roles screen. */
export type RolesTier = 2 | 3 | 4 | 5;

/** One button a Roles region renders. */
export interface RolesAction {
	key: string;
	label: string;
	tier: RolesTier;
	disabled?: boolean;
	/** In flight: the control shows progress and does not repeat. */
	busy?: boolean;
}

/** The Button props a tier draws with — every Roles button takes its tone from here. */
export function rolesTierProps(
	tier: RolesTier,
): ButtonSemanticTone | ButtonStructuralTone | ButtonNeutralTone {
	if (tier === 2) return { structural: true };
	if (tier === 3) return { variant: "filled" };
	if (tier === 4) return { severity: "neutral", variant: "outlined" };
	return { variant: "text" };
}

/** How many filled buttons a region draws — the merge gate is "at most one" (§B.8.1). */
export function rolesFilledCount(actions: readonly { tier: ButtonTier }[]): number {
	return actions.filter((a) => isFilledTier(a.tier)).length;
}

/**
 * A role dialog's footer: Cancel (tier 5) and its one filled commit — "Create role" at tier 2 (a
 * structural creation) or, editing, "Save changes" at tier 3 (a workflow commit). The commit stays
 * pressable while the form has a problem: the press reveals the problem beside its field.
 */
export function roleEditorFooter(mode: RoleEditorMode, saving: boolean): RolesAction[] {
	return [
		{ key: "cancel", label: "Cancel", tier: 5, disabled: saving },
		mode === "create"
			? { key: "commit", label: saving ? "Creating…" : "Create role", tier: 2, busy: saving }
			: { key: "commit", label: saving ? "Saving…" : "Save changes", tier: 3, busy: saving },
	];
}

/**
 * The roster's "New role" — a slim tier-5 list affordance under the Custom roles it adds to (§B.8.1:
 * text weight for list affordances; Decision #321) — for a `manage_roles` holder only; `null`
 * otherwise, so the roster shows none. The header band carries no second copy (Decision #320).
 */
export function newRoleAction(
	viewer: Pick<RolesViewer, "canManage">,
): { key: "new-role"; label: string; tier: 5 } | null {
	return viewer.canManage ? { key: "new-role", label: "New role", tier: 5 } : null;
}
// #endregion

// #region Footer rig (Decision #321)
/** Where the Roles screen's permission edits stand — the footer rig's `SaveStatus` pip. */
export type RolesSaveState = "saved" | "dirty" | "saving" | "error";

/** A text action the footer's save line offers. */
export type RolesSaveAction = "save" | "discard" | "retry";

/** "just now", "12s ago", "4 min ago", "2 h ago" — how long ago a save landed. */
export function savedAgo(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	if (s < 5) return "just now";
	if (s < 60) return `${s}s ago`;
	const m = Math.round(s / 60);
	if (m < 60) return `${m} min ago`;
	return `${Math.round(m / 60)} h ago`;
}

/**
 * The footer's save line, the catalogue rig's contract (Decision #304): with auto-save on, a switch
 * saves itself a moment after it moves, so "Unsaved changes" offers nothing to press; with it off, the
 * line offers Save now and Discard; a failed save offers Retry and Discard.
 */
export function rolesSaveLabel(
	state: RolesSaveState,
	savedAt: number | null,
	now: number,
	autoSave: boolean,
): { text: string; actions: RolesSaveAction[] } {
	switch (state) {
		case "saving":
			return { text: "Saving…", actions: [] };
		case "dirty":
			return { text: "Unsaved changes", actions: autoSave ? [] : ["save", "discard"] };
		case "error":
			return { text: "Couldn't save", actions: ["retry", "discard"] };
		case "saved":
			return {
				text: savedAt === null ? "All changes saved" : `Saved · ${savedAgo(now - savedAt)}`,
				actions: [],
			};
	}
}

/** How long auto-save waits after the last switch moved, so a run of toggles is one write per role. */
export const ROLES_AUTOSAVE_MS = 800;

/** One icon action of the footer rig, for the selected role. */
export interface RigAction {
	key: "edit" | "duplicate" | "archive";
	/** The tooltip and accessible name. */
	label: string;
	/** Why it is refused — said in its tooltip, the control staying focusable — or `null`. */
	disabledReason: string | null;
}

/**
 * The footer rig's actions for the selected role, in order. A custom role: Edit role details,
 * Duplicate role, Archive role — each refused in place ({@link roleActionRows}). A preset: Clone as
 * custom role alone (its permissions are fixed). Nothing without `manage_roles`. "Delete" in a brief
 * is Archive here: nothing is hard-deleted (root CLAUDE.md §5), and `org.archive_workspace_role` is
 * the role's only exit.
 */
export function rigActions(
	role: WorkspaceRoleDef,
	viewer: RolesViewer,
	invites: readonly WorkspaceInvite[],
): RigAction[] {
	if (!viewer.canManage) return [];
	if (role.preset) {
		return [{ key: "duplicate", label: "Clone as custom role", disabledReason: null }];
	}
	const label = { edit: "Edit role details", duplicate: "Duplicate role", archive: "Archive role" };
	return roleActionRows(role, viewer, invites).map((row) => ({
		key: row.action,
		label: label[row.action],
		disabledReason: row.disabledReason,
	}));
}
// #endregion

// #region Copy sweep
/**
 * Every fixed sentence the Roles screen can give a kind — the roster's headings and empty line, each
 * domain's heading and remit, each capability's line and rule, every lock, the dialogs' intros and
 * hints. A sweep reads it (`members-screen.gate.test.ts`: a business's copy never says "lead").
 */
export function rolesScreenCopy(kind: WorkspaceKind, policy: PolicyContext): string[] {
	const caps = capabilitiesForKind(kind);
	return [
		...rosterSections([], {}).flatMap((s) => [s.title, s.empty ?? ""]),
		roleSummaryLine({ summary: "", preset: null, capabilities: [] }, kind),
		...capabilityGroupsFor(kind).flatMap((g) => [g.title, g.description]),
		...caps.map((c) => capabilityLine(c, kind)),
		...caps.map((c) => conditionalRuleFor(c, policy) ?? ""),
		PRESET_LOCK,
		RANK_LOCK,
		VIEW_LOCK,
		GRANT_LOCK,
		RESERVED_LOCK,
		BUSY_LOCK,
		CUSTOM_EMPTY,
		EDIT_BLOCKED_HINT,
		ARCHIVE_HINT,
		cloneHint({ capabilities: [], basePreset: "member" }),
		roleEditorIntro("edit", kind, []),
		...cloneOptionGroups(startPoints(kind, [])).map((g) => g.label),
	].filter((s) => s !== "");
}
// #endregion
