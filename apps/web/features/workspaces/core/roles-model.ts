import type { MenuItem } from "@ui/types/mod.ts";
import type { MetaLineEntry } from "@ui/display/core/meta-line.tsx";
import type {
	ButtonNeutralTone,
	ButtonSemanticTone,
	ButtonStructuralTone,
} from "@ui/fields/types/button.ts";
import type {
	PermissionCellState,
	PermissionMatrixColumn,
	PermissionMatrixRow,
} from "@ui/display/core/permission-matrix-nav.ts";
import {
	capabilitiesForKind,
	CAPABILITY_LABEL,
	CONSEQUENTIAL,
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
	type WorkspaceRole,
	type WorkspaceRoleDef,
} from "@projective/types/workspace";
import {
	capabilityGroupsFor,
	cellStateFor,
	conditionalRuleFor,
	type PolicyContext,
} from "./capabilities.ts";
import { sensitiveWarning } from "./members-model.ts";
import { ROLE_TEMPLATES, type RoleTemplate, templatesForKind } from "./role-templates.ts";
import { type ButtonTier, isFilledTier } from "./header-model.ts";

/**
 * roles-model — every rule the Roles module renders, as pure functions (Teams work order C3).
 *
 * `RolesMatrix.island.tsx` is a binding over this file: which columns the `PermissionMatrix` draws
 * and in what order, what each cell says, which cells and columns are locked and WHY, how a toggle
 * moves the local draft, what the footer rig's Save writes (and what it refuses before the server
 * would), what a role column's menu offers, what the role editor seeds from a template or a copy,
 * which ranks it offers, how a name is judged and which buttons each region holds.
 *
 * **The server's refusals, said before the press.** `org.upsert_workspace_role` refuses a role that
 * carries a capability its author does not hold, one that ranks above its author, a business role
 * carrying an owner-reserved right, and any edit of a preset; `org.archive_workspace_role` refuses a
 * role somebody holds or a pending invitation offers. Each refusal here is a LOCK with its sentence —
 * a cell, a column or a menu row that stays visible and says why — never a control that fails on
 * press. Anything a role already allows may be taken away (the drawer's rule, `capabilityToggleable`).
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
	/** Whether the viewer holds `manage_roles` — without it the matrix is read-only. */
	canManage: boolean;
}

/** The viewer of a detail projection: their own row's rank and the server-resolved capabilities. */
export function rolesViewerOf(
	ws: Pick<WorkspaceDetail, "kind" | "viewerCapabilities" | "members" | "viewerMemberId">,
): RolesViewer {
	const self = ws.members.find((m) => m.id === ws.viewerMemberId) ??
		ws.members.find((m) => m.isSelf) ?? null;
	return {
		kind: ws.kind,
		caps: ws.viewerCapabilities,
		rank: self ? roleRank(self.rolePreset) : 0,
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
// #endregion

// #region Locks
/** Why a preset column's cells cannot change — every preset, the owner's included. */
export const PRESET_LOCK = "Preset roles can't be edited — create a custom role.";

/** Why a custom role that ranks above the viewer is theirs to read, not to change. */
export const RANK_LOCK = "This role ranks above yours, so only someone of its rank can change it.";

/** Why the viewer cannot switch on a capability they do not hold themselves. */
export const GRANT_LOCK = "You can't grant a permission you don't hold yourself.";

/** Why a business role never carries an owner-reserved right (Decision #230 (d), #238). */
export const RESERVED_LOCK =
	"Billing, withdrawals and archiving go to a named admin by the owner — never to a role.";

/**
 * Why an editable cell waits while a role write (the footer rig's Save, or an archive) is in flight —
 * the screen takes no toggle meanwhile, so the cell says so rather than ignoring the press.
 */
export const BUSY_LOCK = "Saving — this can change again once the save lands.";

/**
 * Why a whole role column is locked, or `null` when its cells are the viewer's to change: a preset
 * is read-only (the server refuses any edit of one), and a custom role that ranks above the viewer
 * cannot be saved by them (`basePreset: a role cannot rank above you`).
 */
export function columnLock(
	role: Pick<WorkspaceRoleDef, "preset" | "basePreset">,
	viewer: Pick<RolesViewer, "rank">,
): string | null {
	if (role.preset) return PRESET_LOCK;
	if (roleRank(role.basePreset) > viewer.rank) return RANK_LOCK;
	return null;
}

/**
 * Why one cell of an editable custom-role column cannot change, or `null` when it can. Anything the
 * role allows may be taken away; an off cell may be switched on only for a capability the viewer
 * holds, and never for a business's owner-reserved rights, which no role may carry. While a role
 * write is in flight (`busy`) every such cell waits, with {@link BUSY_LOCK}.
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

// #region Cells
/** A role's draft: capability lists per custom role id, only for roles the viewer has edited. */
export type RoleDraft = Readonly<Record<string, readonly WorkspaceCapability[]>>;

/** The capabilities a role column shows — the draft's when the viewer has edited it. */
export function roleCaps(
	role: Pick<WorkspaceRoleDef, "id" | "capabilities">,
	draft: RoleDraft,
): readonly WorkspaceCapability[] {
	return draft[role.id] ?? role.capabilities;
}

/**
 * The state a cell draws. The owner column is all-allowed (the owner holds every capability the kind
 * renders); elsewhere a granted capability is `conditional` when a rule the entity configured bounds
 * it (`conditionalRuleFor` — the rule is the row's hint), else `allowed`; anything not granted is
 * `off`. Locks never change the state drawn — the `PermissionMatrix` fixes the cell and keeps it.
 */
export function roleCellState(
	role: Pick<WorkspaceRoleDef, "preset">,
	capability: WorkspaceCapability,
	caps: readonly WorkspaceCapability[],
	policy: PolicyContext,
): PermissionCellState {
	if (role.preset === "owner") return "allowed";
	const state = cellStateFor(caps.includes(capability), capability, policy);
	return state === "denied" ? "off" : state;
}
// #endregion

// #region Rows and columns
/**
 * The matrix rows: the capabilities the kind renders (`capabilityGroupsFor` over the kind-filtered
 * SSOT list — never re-listed here), grouped People · Work · Money · Admin. A consequential capability
 * is flagged `sensitive` and says what holding it lets a person do; a capability bounded by a rule
 * the entity configured says the rule instead, since that rule is what its half glyph means.
 */
export function roleMatrixRows(kind: WorkspaceKind, policy: PolicyContext): PermissionMatrixRow[] {
	return capabilityGroupsFor(kind).flatMap((group) =>
		group.capabilities.map((capability) => {
			const sensitive = CONSEQUENTIAL.includes(capability);
			const hint = conditionalRuleFor(capability, policy) ??
				(sensitive ? sensitiveWarning(capability, kind) : null);
			return {
				key: capability,
				label: CAPABILITY_LABEL[capability],
				group: group.title,
				...(sensitive ? { sensitive: true } : {}),
				...(hint ? { hint } : {}),
			};
		})
	);
}

/** Presets first, most- to least-privileged, then the custom roles in the server's order. */
export function orderedRoles(roles: readonly WorkspaceRoleDef[]): WorkspaceRoleDef[] {
	const presets = roles.filter((r) => r.preset !== null)
		.sort((a, b) => roleRank(b.preset ?? "member") - roleRank(a.preset ?? "member"));
	return [...presets, ...roles.filter((r) => r.preset === null)];
}

/** The page head's MetaLine: how many presets and how many custom roles the entity has. */
export function rolesHeaderItems(
	roles: readonly Pick<WorkspaceRoleDef, "preset">[],
): MetaLineEntry[] {
	const presets = roles.filter((r) => r.preset !== null).length;
	const custom = roles.length - presets;
	return [
		{ text: `${presets} ${presets === 1 ? "preset" : "presets"}`, tabular: true },
		{ text: `${custom} custom ${custom === 1 ? "role" : "roles"}`, tabular: true },
	];
}

/** "3 members", tabular in the column's meta line. */
export function memberCountText(count: number): string {
	return count === 1 ? "1 member" : `${count} members`;
}

/**
 * A role column's meta line: who holds it, then — for a custom role — the preset it is based on (its
 * rank), then whether it holds unsaved edits.
 */
export function roleColumnMeta(
	role: Pick<WorkspaceRoleDef, "preset" | "basePreset" | "memberCount">,
	edited: boolean,
): string {
	const parts = [memberCountText(role.memberCount)];
	if (!role.preset) parts.push(`based on ${roleLabel(role.basePreset)}`);
	if (edited) parts.push("edited");
	return parts.join(" · ");
}

/** The matrix columns, in {@link orderedRoles} order, each locked with its reason when it is. */
export function roleMatrixColumns(
	roles: readonly WorkspaceRoleDef[],
	viewer: Pick<RolesViewer, "rank">,
	draft: RoleDraft,
): PermissionMatrixColumn[] {
	const edited = new Set(dirtyRoleIds(roles, draft));
	return orderedRoles(roles).map((role) => {
		const lock = columnLock(role, viewer);
		return {
			key: role.id,
			label: role.name,
			meta: roleColumnMeta(role, edited.has(role.id)),
			...(lock ? { locked: true, lockedHint: lock } : {}),
		};
	});
}

/** One line of the Roles screen's list of what each role is for. */
export interface RoleRemit {
	key: string;
	name: string;
	summary: string;
}

/**
 * Every role with a written remit, in the matrix's column order — the one-line summary a column
 * header has no room for, said beside the role's name under the matrix.
 */
export function roleRemits(
	roles: readonly WorkspaceRoleDef[],
): RoleRemit[] {
	return orderedRoles(roles)
		.filter((r) => r.summary.trim() !== "")
		.map((r) => ({ key: r.id, name: r.name, summary: r.summary.trim() }));
}
// #endregion

// #region Legend
/** What one legend line explains: one of the matrix's three glyphs, or a cell drawn without its box. */
export type RolesLegendMark = "allowed" | "conditional" | "locked" | "fixed";

/** One line of the legend over the matrix. */
export interface RolesLegendItem {
	mark: RolesLegendMark;
	text: string;
}

/**
 * Every reason a cell of a column the viewer may edit is fixed for them (`cellLock`, never the
 * transient {@link BUSY_LOCK}), in first-seen order — what the legend's no-box line must explain.
 * Empty without `manage_roles`: a read-only matrix fixes no cell of its own.
 */
export function fixedCellReasons(
	roles: readonly WorkspaceRoleDef[],
	viewer: RolesViewer,
	draft: RoleDraft,
): string[] {
	if (!viewer.canManage) return [];
	const reasons = new Set<string>();
	const rows = capabilitiesForKind(viewer.kind);
	for (const role of roles) {
		if (columnLock(role, viewer) !== null) continue;
		const held = roleCaps(role, draft);
		for (const capability of rows) {
			const reason = cellLock(capability, held.includes(capability), viewer);
			if (reason) reasons.add(reason);
		}
	}
	return [...reasons];
}

/**
 * The legend, worded for what the matrix actually draws: Allowed; the conditional line only when a
 * cell is conditional; the padlock line naming every kind of read-only column on screen — a preset,
 * and a custom role ranking above the viewer when there is one, since both carry the padlock; and,
 * when a cell the viewer could otherwise edit is fixed, the line saying what its missing box means
 * and why (a grant they do not hold; a business's owner-reserved right).
 */
export function rolesLegend(input: {
	kind: WorkspaceKind;
	/** Whether any cell on screen is drawn conditional. */
	conditional: boolean;
	/** Each column's lock (`columnLock` / `lockedHint`), or nothing for an editable column. */
	columnLocks: readonly (string | null | undefined)[];
	/** {@link fixedCellReasons}. */
	fixedReasons: readonly string[];
}): RolesLegendItem[] {
	const items: RolesLegendItem[] = [{ mark: "allowed", text: "Allowed" }];
	if (input.conditional) {
		items.push({
			mark: "conditional",
			text: `Allowed within a rule this ${kindCopy(input.kind).noun} set`,
		});
	}
	const presets = input.columnLocks.includes(PRESET_LOCK);
	const ranked = input.columnLocks.includes(RANK_LOCK);
	if (presets || ranked) {
		items.push({
			mark: "locked",
			text: presets && ranked
				? "Read-only — a preset, or a role ranking above yours"
				: presets
				? "Preset — read-only"
				: "Read-only — the role ranks above yours",
		});
	}
	const grant = input.fixedReasons.includes(GRANT_LOCK);
	const reserved = input.fixedReasons.includes(RESERVED_LOCK);
	if (grant || reserved) {
		items.push({
			mark: "fixed",
			text: grant && reserved
				? "No box: you can't grant it — you don't hold it, or the owner reserves it"
				: grant
				? "No box: you don't hold it yourself, so you can't grant it"
				: "No box: owner-reserved — given to a named admin, never to a role",
		});
	}
	return items;
}
// #endregion

// #region Draft
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
 * The draft after one toggle of a custom role's cell. A toggle that returns the role to its saved
 * capabilities drops it from the draft, so flipping a cell twice leaves nothing to save.
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

/** "View audit log", "View audit log and Archive entity", "A, B and C". */
function labelList(caps: readonly WorkspaceCapability[]): string {
	const labels = caps.map((c) => CAPABILITY_LABEL[c]);
	if (labels.length <= 1) return labels.join("");
	return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/**
 * The footer rig's Save over the draft. Every dirty custom role is one write — unless it still allows
 * something the viewer may not put on a role (a capability they lack, or a business's reserved right
 * a legacy role carries), which the server refuses for the whole role; that role is held back with
 * the sentence naming what to switch off, and the others still save.
 */
export function roleSavePlan(
	roles: readonly WorkspaceRoleDef[],
	draft: RoleDraft,
	viewer: Pick<RolesViewer, "kind" | "caps">,
): RoleSavePlan {
	const plan: RoleSavePlan = { writes: [], problems: [] };
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
		} else {
			plan.writes.push({ role, capabilities });
		}
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

// #region Column menu
/** What a role column's menu can ask for. */
export type RoleMenuAction = "rename" | "duplicate" | "archive";

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

/** The Archive row's visible line when nothing refuses it. */
export const ARCHIVE_HINT = "Kept on record, never deleted.";

/**
 * The Archive row's visible second line: the refusal's count and its remedy, short enough for a menu
 * row (the full sentence, {@link archiveBlock}, is the row's tooltip and description) — or, when
 * nothing refuses it, {@link ARCHIVE_HINT}. The count is on the row itself, so a touch reader, or one
 * who never hovers, still sees why the row is dead.
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

/** The Rename row's visible second line when {@link renameBlock} refuses it. */
export const RENAME_BLOCKED_HINT = "It allows what you can't grant.";

/**
 * Why the viewer cannot rename a role they may otherwise edit, or `null`: a rename re-writes the
 * role's saved capabilities, so one that still allows something the viewer may not put on a role is
 * refused whole by the server.
 */
export function renameBlock(
	role: Pick<WorkspaceRoleDef, "name" | "capabilities">,
	viewer: Pick<RolesViewer, "kind" | "caps">,
): string | null {
	const blocked = role.capabilities.filter((c) => !mayGrantToRole(c, viewer));
	return blocked.length === 0
		? null
		: `${role.name} allows ${labelList(blocked)}, which you can't give a role.`;
}

/** One row of a role column's menu, before it is bound to the screen. */
export interface RoleMenuRow {
	action: RoleMenuAction;
	/** Why the row is refused — its tooltip and description — or `null` when it acts. */
	disabledReason: string | null;
	/** The row's visible second line (a refused row's count and remedy), or `null` for none. */
	hint: string | null;
}

/**
 * The menu rows a role column offers, in order — none on a preset (a preset is copied through New
 * role's "Start from") and none without `manage_roles`. Rename only on a column the viewer may edit,
 * refused in place when the role carries what they cannot grant; Duplicate always; Archive always,
 * refused in place while anybody holds the role or an invitation offers it ({@link pendingInvitesFor})
 * — never hidden, and the count and remedy on the row itself, so the reader learns why.
 */
export function roleMenuRows(
	role: WorkspaceRoleDef,
	viewer: RolesViewer,
	invites: readonly WorkspaceInvite[],
): RoleMenuRow[] {
	if (!viewer.canManage || role.preset) return [];
	const rows: RoleMenuRow[] = [];
	if (columnLock(role, viewer) === null) {
		const blocked = renameBlock(role, viewer);
		rows.push({
			action: "rename",
			disabledReason: blocked,
			hint: blocked ? RENAME_BLOCKED_HINT : null,
		});
	}
	rows.push({ action: "duplicate", disabledReason: null, hint: null });
	const offered = pendingInvitesFor(role, invites);
	rows.push({
		action: "archive",
		disabledReason: archiveBlock(role, offered),
		hint: archiveHint(role, offered),
	});
	return rows;
}

/** A role column's kebab menu, bound to the screen's handler. */
export function roleMenu(
	role: WorkspaceRoleDef,
	viewer: RolesViewer,
	invites: readonly WorkspaceInvite[],
	onAction: (action: RoleMenuAction, role: WorkspaceRoleDef) => void,
): MenuItem[] {
	const items: MenuItem[] = [];
	for (const row of roleMenuRows(role, viewer, invites)) {
		const command = () => onAction(row.action, role);
		const act = {
			...(row.hint ? { hint: row.hint } : {}),
			...(row.disabledReason
				? { disabled: true, disabledReason: row.disabledReason }
				: { command }),
		};
		if (row.action === "rename") {
			items.push({ key: "rename", label: "Rename…", icon: "edit", ...act });
		} else if (row.action === "duplicate") {
			items.push({ key: "duplicate", label: "Duplicate…", icon: "copy", ...act });
		} else {
			if (items.length > 0) items.push({ separator: true });
			items.push({
				key: "archive",
				label: "Archive role…",
				icon: "archive-box",
				danger: true,
				...act,
			});
		}
	}
	return items;
}
// #endregion

// #region Role editor
/** Where a new role starts: nothing, a template, or a copy of an existing role. */
export interface StartPoint {
	/** The editor's option value: `blank`, `template:<key>` or `role:<id>`. */
	key: string;
	/** The option's label. */
	label: string;
	/** What it carries, as the option's description and the field's hint. */
	description: string;
	/** The name it suggests ("" for nothing). */
	name: string;
	/** The summary the new role is written with. */
	summary: string;
	/** The rank it suggests (clamped to what the author may create by {@link clampBase}). */
	basePreset: WorkspaceRole;
	/** Its capabilities, before {@link seedFrom} filters them to what the author may grant. */
	capabilities: readonly WorkspaceCapability[];
}

/** The starting point that carries nothing — the editor's default. */
export const BLANK_START = "blank";

/** "View analytics, Invite members" — or a sentence when there is nothing. */
function capsDescription(caps: readonly WorkspaceCapability[]): string {
	return caps.length === 0
		? "No special permissions."
		: `${caps.map((c) => CAPABILITY_LABEL[c]).join(", ")}.`;
}

/**
 * Every starting point the editor offers, in order: nothing, then the kind's templates (data —
 * `role-templates.ts`), then a copy of each existing role, presets first. Copying is how a preset is
 * "edited": its column is locked, and its copy is a custom role the author owns.
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
			label: "Nothing yet",
			description: "No permissions — tick what it may do in its column afterwards.",
			name: "",
			summary: "",
			basePreset: "member",
			capabilities: [],
		},
		...templatesForKind(kind, templates).map((t) => ({
			key: `template:${t.key}`,
			label: `${t.name} template`,
			description: `${t.summary} ${capsDescription(inKind(t.capabilities))}`,
			name: t.name,
			summary: t.summary,
			basePreset: t.basePreset,
			capabilities: inKind(t.capabilities),
		})),
		...orderedRoles(roles).map((r) => ({
			key: `role:${r.id}`,
			label: `Same as ${r.name}`,
			description: capsDescription(
				inKind(r.preset === "owner" ? capabilitiesForKind(kind) : r.capabilities),
			),
			name: `${r.name} copy`,
			summary: r.summary,
			basePreset: r.basePreset,
			capabilities: inKind(r.preset === "owner" ? capabilitiesForKind(kind) : r.capabilities),
		})),
	];
}

/** The starting point a key names, or the blank one. */
export function startPointOf(points: readonly StartPoint[], key: string | null): StartPoint {
	return points.find((p) => p.key === key) ?? points[0];
}

/** The `owner` rank folds to `admin` — the highest a custom role may name. */
function asCustomBase(role: WorkspaceRole): CustomRoleBase {
	return role === "owner" ? "admin" : role;
}

/**
 * The ranks a new custom role may take: the kind's presets (no `lead` on a business), never `owner`,
 * and never above the author's own rank — the database refuses the rest, so they are not offered.
 * Most-privileged first.
 */
export function baseOptions(kind: WorkspaceKind, viewerRank: number): CustomRoleBase[] {
	return rolesForKind(kind).filter((r): r is CustomRoleBase =>
		r !== "owner" && roleRank(r) <= viewerRank
	);
}

/**
 * The rank to start the editor on: the one wanted when it is offered, else the highest offered rank
 * below it, else `member` (which the server will refuse for an author without a seat, with its own
 * sentence).
 */
export function clampBase(
	wanted: WorkspaceRole,
	offered: readonly CustomRoleBase[],
): CustomRoleBase {
	const target = asCustomBase(wanted);
	if (offered.includes(target)) return target;
	return offered.find((r) => roleRank(r) <= roleRank(target)) ?? offered.at(-1) ?? "member";
}

/** What the editor starts a new role with. */
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

/** The editor's line about what a starting point lost on the way in, or `null` when it lost nothing. */
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

/**
 * The editor's opening line. Creating, it follows the starting point: a role that starts with
 * nothing is told to tick its column once it exists; one a template or a copy seeded says what it
 * starts with. Renaming keeps everything but the name and rank.
 */
export function roleEditorIntro(
	mode: RoleEditorMode,
	kind: WorkspaceKind,
	seeded: readonly WorkspaceCapability[],
): string {
	if (mode === "rename") return "Its permissions and the people holding it stay as they are.";
	const lead = `A custom role is a named bundle of permissions for this ${kindCopy(kind).noun}.`;
	return seeded.length === 0
		? `${lead} Tick what it may do in its column once it exists.`
		: `${lead} It starts with ${startsWith(seeded)} — change its column any time.`;
}

/** What the screen says once the editor created a role, by what the role was created with. */
export function roleCreatedNotice(name: string, caps: readonly WorkspaceCapability[]): string {
	return caps.length === 0
		? `${name} is created. Tick what it may do in its column, then save.`
		: `${name} is created with ${startsWith(caps)}. Change its column any time, then save.`;
}

/** The longest role name the database takes (`WorkspaceRoleDef.name`). */
export const ROLE_NAME_MAX = 48;

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

/** Which job the editor is doing. */
export type RoleEditorMode = "create" | "rename";

/** The custom-role write the editor sends. */
export function roleEditorInput(
	ws: Pick<WorkspaceDetail, "kind" | "id">,
	input: {
		mode: RoleEditorMode;
		name: string;
		basePreset: CustomRoleBase;
		/** Create: the seed's capabilities and the starting point's summary. */
		seed?: { capabilities: readonly WorkspaceCapability[]; summary: string };
		/** Rename: the role being renamed, whose saved capabilities and summary are kept. */
		role?: WorkspaceRoleDef;
	},
): UpsertRoleInput {
	const base = {
		kind: ws.kind,
		workspaceId: ws.id,
		name: input.name.trim(),
		basePreset: input.basePreset,
	};
	if (input.mode === "rename" && input.role) {
		return {
			...base,
			roleId: input.role.id,
			summary: input.role.summary,
			capabilities: [...input.role.capabilities],
		};
	}
	return {
		...base,
		summary: input.seed?.summary ?? "",
		capabilities: [...(input.seed?.capabilities ?? [])],
	};
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
 * The editor's footer: Cancel (tier 5) and its one filled commit — "Create role" at tier 2 (a
 * structural creation) or, renaming, "Save role" at tier 3 (a workflow commit). The commit stays
 * pressable while the form has a problem: the press reveals the problem beside its field.
 */
export function roleEditorFooter(mode: RoleEditorMode, saving: boolean): RolesAction[] {
	return [
		{ key: "cancel", label: "Cancel", tier: 5, disabled: saving },
		mode === "create"
			? { key: "commit", label: saving ? "Creating…" : "Create role", tier: 2, busy: saving }
			: { key: "commit", label: saving ? "Saving…" : "Save role", tier: 3, busy: saving },
	];
}

/**
 * The header band's commit on the Roles module — "New role", tier 2 structural (it opens the
 * editor) — for a `manage_roles` holder only; `null` otherwise, so the band shows none.
 */
export function rolesCommit(
	viewer: Pick<RolesViewer, "canManage">,
): { key: "new-role"; label: string; tier: 2 } | null {
	return viewer.canManage ? { key: "new-role", label: "New role", tier: 2 } : null;
}
// #endregion
