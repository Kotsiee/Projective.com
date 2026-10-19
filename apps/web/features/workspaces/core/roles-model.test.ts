import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import {
	capabilitiesForKind,
	CONSEQUENTIAL,
	isBusinessManagerRole,
	presetCapabilities,
	roleRank,
	type WorkspaceCapability,
	WorkspaceCapability as CapabilityEnum,
	type WorkspaceInvite,
	type WorkspaceKind,
	type WorkspaceMember,
	type WorkspaceRole,
	type WorkspaceRoleDef,
} from "@projective/types/workspace";
import { CAPABILITY_GROUPS, type PolicyContext } from "./capabilities.ts";
import { sensitiveWarning } from "./members-model.ts";
import { ROLE_TEMPLATES, type RoleTemplate, templatesForKind } from "./role-templates.ts";
import {
	ARCHIVE_HINT,
	archiveBlock,
	archiveHint,
	baseOptions,
	BLANK_START,
	BUSY_LOCK,
	CAPPED_LEGEND,
	cellLock,
	clampBase,
	columnLock,
	dirtyRoleIds,
	draftManagersUsed,
	fixedCellReasons,
	GRANT_LOCK,
	invitesOffering,
	managerCapLine,
	managerCapLock,
	managerCapLocked,
	managerDelta,
	mayGrantToRole,
	orderedRoles,
	pendingInvitesFor,
	PRESET_LOCK,
	pruneDraft,
	RANK_LOCK,
	RENAME_BLOCKED_HINT,
	renameBlock,
	RESERVED_LOCK,
	ROLE_NAME_EXAMPLE,
	ROLE_NAME_MAX,
	type RoleCapContext,
	roleCaps,
	roleCellState,
	roleColumnMeta,
	roleCreatedNotice,
	type RoleDraft,
	roleEditorFooter,
	roleEditorInput,
	roleEditorIntro,
	roleMatrixColumns,
	roleMatrixRows,
	roleMenu,
	roleMenuRows,
	roleNameProblem,
	roleRemits,
	roleSavePlan,
	rolesCommit,
	rolesFilledCount,
	rolesHeaderItems,
	rolesLegend,
	rolesTierProps,
	type RolesViewer,
	rolesViewerOf,
	roleWriteInput,
	seedFrom,
	seedNote,
	startPointOf,
	startPoints,
	toggleRoleCap,
} from "./roles-model.ts";

/**
 * The Roles module's rules (Teams work order C3): the matrix's rows (the kind's own capability list,
 * grouped People · Work · Money · Admin) and columns (presets, then custom roles), every lock the
 * server would otherwise refuse on press — with its reason — the draft and the footer rig's Save, the
 * column menu and the archive refusal, and the role editor's starting points (the Contributor
 * template is data), ranks, seed, name check and one filled control per region.
 */

// #region Fixtures
const OWNER_CAPS = presetCapabilities("owner", "team");
const ADMIN_CAPS = presetCapabilities("admin", "team");
const LEAD_CAPS = presetCapabilities("lead", "team");
const MEMBER_CAPS = presetCapabilities("member", "team");

function role(
	id: string,
	preset: WorkspaceRole | null,
	base: WorkspaceRole,
	capabilities: readonly WorkspaceCapability[],
	name = preset ? preset[0].toUpperCase() + preset.slice(1) : id,
	memberCount = 1,
): WorkspaceRoleDef {
	return {
		id,
		name,
		summary: `${name} summary`,
		preset,
		basePreset: base,
		capabilities: [...capabilities],
		memberCount,
	};
}

/** Server order: custom roles interleaved, presets out of rank order — the model must sort. */
const ROLES: WorkspaceRoleDef[] = [
	role("r-member", "member", "member", MEMBER_CAPS, undefined, 3),
	role("r-designer", null, "lead", ["publish_listings", "view_analytics"], "Designer", 0),
	role("r-owner", "owner", "owner", OWNER_CAPS),
	role("r-lead", "lead", "lead", LEAD_CAPS, undefined, 2),
	role("r-treasurer", null, "admin", ["manage_finances", "withdraw_funds"], "Treasurer", 0),
	role("r-admin", "admin", "admin", ADMIN_CAPS),
];

const byId = (id: string) => ROLES.find((r) => r.id === id)!;

function viewer(preset: WorkspaceRole, kind: WorkspaceKind = "team"): RolesViewer {
	const caps = presetCapabilities(preset, kind);
	const rank = { owner: 4, admin: 3, lead: 2, member: 1 }[preset];
	return { kind, caps, rank, canManage: caps.includes("manage_roles") };
}

const TEAM_POLICY = { kind: "team", payout: null, spend: null, canPropose: true } as PolicyContext;

function invite(id: string, roleId: string): WorkspaceInvite {
	return {
		id,
		handle: id,
		name: id,
		avatar: "",
		email: null,
		roleId,
		note: null,
		sentAt: "2 days ago",
		expiresAt: null,
	};
}

function member(id: string, preset: WorkspaceRole): WorkspaceMember {
	return {
		id,
		handle: id,
		name: id,
		avatar: "",
		email: null,
		roleId: `r-${preset}`,
		rolePreset: preset,
		state: "active",
		overrides: { granted: [], revoked: [] },
		joinedAt: "2026-09-01T00:00:00Z",
		title: null,
		workload: 0,
		wi: 0,
		wiCap: 10,
		availability: "available",
		isSelf: false,
		spendLimitMinor: null,
		contributedMinor: 0,
		shareBp: 0,
		shareHeld: false,
		reportsTo: null,
	};
}
// #endregion

// #region Rows
Deno.test("groups: every capability sits in exactly one of People · Work · Money · Admin", () => {
	assertEquals(CAPABILITY_GROUPS.map((g) => g.title), ["People", "Work", "Money", "Admin"]);
	const listed = CAPABILITY_GROUPS.flatMap((g) => g.capabilities);
	assertEquals(listed.length, new Set(listed).size, "a capability in two groups");
	assertEquals([...listed].sort(), [...CapabilityEnum.options].sort(), "a capability in no group");
});

Deno.test("rows: exactly the capabilities the kind renders — imported, never re-listed", () => {
	for (const kind of ["team", "business"] as WorkspaceKind[]) {
		const rows = roleMatrixRows(kind, { ...TEAM_POLICY, kind });
		assertEquals(
			rows.map((r) => r.key).sort(),
			[...capabilitiesForKind(kind)].sort(),
			kind,
		);
		// Grouped in runs, in the shared order.
		const groups = rows.map((r) => r.group);
		const runs = groups.filter((g, i) => g !== groups[i - 1]);
		assertEquals(runs, ["People", "Work", "Money", "Admin"], kind);
	}
	const team = roleMatrixRows("team", TEAM_POLICY).map((r) => r.key);
	for (const cap of ["purchase", "hire", "contribute_funds", "approve_spend", "manage_billing"]) {
		assert(!team.includes(cap), `a team renders ${cap}`);
	}
	const business = roleMatrixRows("business", { ...TEAM_POLICY, kind: "business" }).map((r) =>
		r.key
	);
	for (const cap of ["bind_seat", "publish_listings"]) {
		assert(!business.includes(cap), `a business renders ${cap}`);
	}
});

Deno.test("rows: sensitive rows are flagged and say what holding them does; a rule wins the hint", () => {
	const rows = roleMatrixRows("team", TEAM_POLICY);
	for (const row of rows) {
		const cap = row.key as WorkspaceCapability;
		assertEquals(row.sensitive === true, CONSEQUENTIAL.includes(cap), cap);
		if (row.sensitive) assertEquals(row.hint, sensitiveWarning(cap, "team") ?? undefined, cap);
		else assertStrictEquals(row.hint, undefined, cap);
	}
	// A rule the entity configured (a one-person team cannot bid yet) is the row's hint.
	const bind = roleMatrixRows("team", { ...TEAM_POLICY, canPropose: false })
		.find((r) => r.key === "bind_seat");
	assertEquals(
		bind?.hint,
		"The team needs at least two active members before it can bid for a seat.",
	);
	assert(bind?.sensitive);
});
// #endregion

// #region Columns
Deno.test("columns: presets first, most-privileged first, then custom roles in the server's order", () => {
	assertEquals(orderedRoles(ROLES).map((r) => r.id), [
		"r-owner",
		"r-admin",
		"r-lead",
		"r-member",
		"r-designer",
		"r-treasurer",
	]);
});

Deno.test("columns: presets are locked with the preset reason; the owner's is all-allowed", () => {
	const cols = roleMatrixColumns(ROLES, viewer("owner"), {});
	for (const col of cols.slice(0, 4)) {
		assertEquals(col.locked, true, col.key);
		assertEquals(col.lockedHint, PRESET_LOCK, col.key);
	}
	assertEquals(PRESET_LOCK, "Preset roles can't be edited — create a custom role.");
	for (const cap of capabilitiesForKind("team")) {
		assertEquals(roleCellState(byId("r-owner"), cap, [], TEAM_POLICY), "allowed", cap);
	}
	// The owner viewing: every custom role is theirs to edit.
	assert(cols.slice(4).every((c) => !c.locked));
});

Deno.test("columns: a custom role ranking above the viewer is locked whole, with its reason", () => {
	const lead = viewer("lead");
	assertEquals(columnLock(byId("r-treasurer"), lead), RANK_LOCK);
	assertStrictEquals(columnLock(byId("r-designer"), lead), null);
	const cols = roleMatrixColumns(ROLES, lead, {});
	assertEquals(cols.find((c) => c.key === "r-treasurer")?.lockedHint, RANK_LOCK);
	assertEquals(cols.find((c) => c.key === "r-designer")?.locked, undefined);
});

Deno.test("columns: the meta counts holders first, names an unsaved edit and a custom role's base", () => {
	assertEquals(roleColumnMeta(byId("r-member"), false), ["3 members"]);
	assertEquals(roleColumnMeta(byId("r-owner"), false), ["1 member"]);
	// The count leads line one in every column; "based on …" is a line of its own, clean or edited.
	assertEquals(roleColumnMeta(byId("r-designer"), false), ["0 members", "based on Lead"]);
	assertEquals(roleColumnMeta(byId("r-designer"), true), ["0 members · edited", "based on Lead"]);
	const draft = toggleRoleCap({}, byId("r-designer"), "manage_projects");
	const cols = roleMatrixColumns(ROLES, viewer("owner"), draft);
	assertEquals(cols.find((c) => c.key === "r-designer")?.meta, [
		"0 members · edited",
		"based on Lead",
	]);
	assertEquals(cols.find((c) => c.key === "r-member")?.meta, ["3 members"]);
});

Deno.test("header: presets · custom roles, tabular", () => {
	assertEquals(rolesHeaderItems(ROLES), [
		{ text: "4 presets", tabular: true },
		{ text: "2 custom roles", tabular: true },
	]);
	assertEquals(rolesHeaderItems([byId("r-owner"), byId("r-designer")]), [
		{ text: "1 preset", tabular: true },
		{ text: "1 custom role", tabular: true },
	]);
});

Deno.test("remits: every written summary, in column order — the line a header has no room for", () => {
	const unwritten = { ...byId("r-designer"), summary: "  " };
	const roles = ROLES.map((r) => (r.id === "r-designer" ? unwritten : r));
	assertEquals(roleRemits(roles), [
		{ key: "r-owner", name: "Owner", summary: "Owner summary" },
		{ key: "r-admin", name: "Admin", summary: "Admin summary" },
		{ key: "r-lead", name: "Lead", summary: "Lead summary" },
		{ key: "r-member", name: "Member", summary: "Member summary" },
		{ key: "r-treasurer", name: "Treasurer", summary: "Treasurer summary" },
	]);
});
// #endregion

// #region Legend
Deno.test("legend: the padlock line names every kind of read-only column on screen", () => {
	const base = { kind: "team" as const, conditional: false, fixedReasons: [] };
	// The owner: only presets carry the padlock.
	const owner = rolesLegend({
		...base,
		columnLocks: roleMatrixColumns(ROLES, viewer("owner"), {}).map((c) => c.lockedHint),
	});
	assertEquals(owner, [
		{ mark: "allowed", text: "Allowed" },
		{ mark: "locked", text: "Preset — read-only" },
	]);
	// A lead granted manage_roles: Treasurer ranks above them and carries the same padlock, so the
	// line may not call every padlocked column a preset.
	const lead = rolesLegend({
		...base,
		columnLocks: roleMatrixColumns(ROLES, viewer("lead"), {}).map((c) => c.lockedHint),
	});
	assertEquals(lead.at(-1), {
		mark: "locked",
		text: "Read-only — a preset, or a role ranking above yours",
	});
	assertEquals(
		rolesLegend({ ...base, columnLocks: [RANK_LOCK] }).at(-1)?.text,
		"Read-only — the role ranks above yours",
	);
	// The conditional line only when a cell is conditional.
	assertEquals(
		rolesLegend({ ...base, conditional: true, columnLocks: [PRESET_LOCK] })[1],
		{ mark: "conditional", text: "Allowed within a rule this team set" },
	);
});

Deno.test("legend: a cell fixed for the viewer is explained — its missing box and the reason", () => {
	const lead = {
		...viewer("lead"),
		caps: [...LEAD_CAPS, "manage_roles" as const],
		canManage: true,
	};
	// Designer is the lead's to edit; withdraw_funds (off, and not theirs) is fixed for them.
	assertEquals(fixedCellReasons(ROLES, lead, {}), [GRANT_LOCK]);
	assertEquals(
		rolesLegend({ kind: "team", conditional: false, columnLocks: [], fixedReasons: [GRANT_LOCK] }),
		[
			{ mark: "allowed", text: "Allowed" },
			{ mark: "fixed", text: "No box: you don't hold it yourself, so you can't grant it" },
		],
	);
	// A team owner holds every right and a team reserves none: nothing is fixed, no line.
	assertEquals(fixedCellReasons(ROLES, viewer("owner"), {}), []);
	// Without manage_roles the matrix is read-only — nothing of the viewer's is fixed.
	assertEquals(fixedCellReasons(ROLES, { ...lead, canManage: false }, {}), []);
	// A business owner: the reserved rights are fixed on every custom role.
	const bizRoles = [
		role("b-owner", "owner", "owner", presetCapabilities("owner", "business")),
		role("b-buyer", null, "member", ["purchase"], "Purchaser"),
	];
	assertEquals(fixedCellReasons(bizRoles, viewer("owner", "business"), {}), [RESERVED_LOCK]);
	assertEquals(
		rolesLegend({
			kind: "business",
			conditional: false,
			columnLocks: [],
			fixedReasons: [RESERVED_LOCK],
		}).at(-1)?.text,
		"No box: owner-reserved — given to a named admin, never to a role",
	);
	assertEquals(
		rolesLegend({
			kind: "business",
			conditional: false,
			columnLocks: [],
			fixedReasons: [RESERVED_LOCK, GRANT_LOCK],
		}).at(-1)?.text,
		"No box: you can't grant it — you don't hold it, or the owner reserves it",
	);
	// The save lock is transient and never a legend line.
	assertEquals(
		rolesLegend({ kind: "team", conditional: false, columnLocks: [], fixedReasons: [BUSY_LOCK] })
			.length,
		1,
	);
});
// #endregion

// #region Cells
Deno.test("cells: granted is allowed, a configured rule makes it conditional, else off", () => {
	const designer = byId("r-designer");
	assertEquals(
		roleCellState(designer, "view_analytics", designer.capabilities, TEAM_POLICY),
		"allowed",
	);
	assertEquals(
		roleCellState(designer, "invite_members", designer.capabilities, TEAM_POLICY),
		"off",
	);
	const lead = byId("r-lead");
	assertEquals(
		roleCellState(lead, "bind_seat", lead.capabilities, { ...TEAM_POLICY, canPropose: false }),
		"conditional",
	);
	// The draft is what a column draws.
	const draft = toggleRoleCap({}, designer, "invite_members");
	assertEquals(
		roleCellState(designer, "invite_members", roleCaps(designer, draft), TEAM_POLICY),
		"allowed",
	);
});

Deno.test("cell locks: anything on may be taken away; off needs the grant, and never a reserved right", () => {
	const lead = viewer("lead");
	// On: always removable, even what the viewer lacks.
	assertStrictEquals(cellLock("withdraw_funds", true, lead), null);
	// Off: switching on is granting.
	assertEquals(cellLock("withdraw_funds", false, lead), GRANT_LOCK);
	assertStrictEquals(cellLock("publish_listings", false, lead), null);
	// A team reserves nothing: its owner may put withdraw_funds on a role.
	assertStrictEquals(cellLock("withdraw_funds", false, viewer("owner")), null);
	// A business's reserved rights are never a role's — not even at the owner's hand.
	const owner = viewer("owner", "business");
	for (
		const cap of ["withdraw_funds", "manage_billing", "archive_entity"] as WorkspaceCapability[]
	) {
		assertEquals(cellLock(cap, false, owner), RESERVED_LOCK, cap);
		assertStrictEquals(cellLock(cap, true, owner), null, `${cap} on may be taken away`);
		assert(!mayGrantToRole(cap, owner));
	}
	assert(mayGrantToRole("spend_funds", owner));
});

Deno.test("cell locks: while a write is in flight every editable cell waits, and says so", () => {
	const owner = viewer("owner");
	assertEquals(cellLock("view_analytics", true, owner, true), BUSY_LOCK);
	assertEquals(cellLock("view_analytics", false, owner, true), BUSY_LOCK);
	assertStrictEquals(cellLock("view_analytics", false, owner, false), null);
});
// #endregion

// #region Draft
Deno.test("draft: a toggle adds or removes in canonical order; toggling back leaves nothing to save", () => {
	const designer = byId("r-designer");
	const once = toggleRoleCap({}, designer, "invite_members");
	assertEquals(once["r-designer"], ["invite_members", "publish_listings", "view_analytics"]);
	assertEquals(dirtyRoleIds(ROLES, once), ["r-designer"]);
	const back = toggleRoleCap(once, designer, "invite_members");
	assertEquals(back, {});
	assertEquals(dirtyRoleIds(ROLES, back), []);
	const removed = toggleRoleCap({}, designer, "view_analytics");
	assertEquals(removed["r-designer"], ["publish_listings"]);
});

Deno.test("draft: presets never count as dirty, and a role the detail dropped is pruned", () => {
	const draft: RoleDraft = {
		"r-admin": [],
		"r-gone": ["view_analytics"],
		"r-designer": ["view_audit"],
	};
	assertEquals(dirtyRoleIds(ROLES, draft), ["r-designer"]);
	assertEquals(Object.keys(pruneDraft(draft, ROLES)), ["r-designer"]);
});
// #endregion

// #region Save
Deno.test("save: one write per edited custom role, keeping its name, summary and rank", () => {
	let draft = toggleRoleCap({}, byId("r-designer"), "manage_projects");
	draft = toggleRoleCap(draft, byId("r-treasurer"), "view_analytics");
	const plan = roleSavePlan(ROLES, draft, viewer("owner"));
	assertEquals(plan.problems, []);
	assertEquals(plan.writes.map((w) => w.role.id), ["r-designer", "r-treasurer"]);
	assertEquals(roleWriteInput({ kind: "team", id: "ws-1" }, plan.writes[0]), {
		kind: "team",
		workspaceId: "ws-1",
		roleId: "r-designer",
		name: "Designer",
		summary: "Designer summary",
		capabilities: ["manage_projects", "publish_listings", "view_analytics"],
		basePreset: "lead",
	});
});

Deno.test("save: a role still allowing what the viewer can't grant is held back with its reason", () => {
	// An admin edits Treasurer (base admin) but it still allows withdraw_funds, which they lack.
	const admin = viewer("admin");
	const draft = toggleRoleCap(
		toggleRoleCap({}, byId("r-treasurer"), "view_analytics"),
		byId("r-designer"),
		"manage_projects",
	);
	const plan = roleSavePlan(ROLES, draft, admin);
	assertEquals(plan.writes.map((w) => w.role.id), ["r-designer"], "the others still save");
	assertEquals(plan.problems, [{
		roleId: "r-treasurer",
		text:
			"Treasurer still allows Withdraw funds, which you can't give a role — switch it off to save it.",
	}]);
	// Switching it off clears the problem.
	const fixed = toggleRoleCap(draft, byId("r-treasurer"), "withdraw_funds");
	assertEquals(roleSavePlan(ROLES, fixed, admin).problems, []);
});
// #endregion

// #region Column menu
Deno.test("menu: none on a preset or without manage_roles; Rename only where the column is editable", () => {
	const owner = viewer("owner");
	assertEquals(roleMenuRows(byId("r-admin"), owner, []), []);
	assertEquals(roleMenuRows(byId("r-designer"), { ...owner, canManage: false }, []), []);
	assertEquals(roleMenuRows(byId("r-designer"), owner, []).map((r) => r.action), [
		"rename",
		"duplicate",
		"archive",
	]);
	// A lead granted manage_roles on top of their role, on a role ranking above them: no Rename (its
	// column says why); Duplicate and Archive remain.
	const lead = {
		...viewer("lead"),
		caps: [...LEAD_CAPS, "manage_roles" as const],
		canManage: true,
	};
	assertEquals(roleMenuRows(byId("r-treasurer"), lead, []).map((r) => r.action), [
		"duplicate",
		"archive",
	]);
	// A role carrying what the viewer can't grant: Rename refused in place, with the reason.
	const admin = viewer("admin");
	assertEquals(
		renameBlock(byId("r-treasurer"), admin),
		"Treasurer allows Withdraw funds, which you can't give a role.",
	);
	assertEquals(roleMenuRows(byId("r-treasurer"), admin, [])[0], {
		action: "rename",
		disabledReason: "Treasurer allows Withdraw funds, which you can't give a role.",
		hint: RENAME_BLOCKED_HINT,
	});
	assertEquals(roleMenuRows(byId("r-designer"), owner, [])[0].hint, null);
});

Deno.test("archive: refused with the count and the reason while anybody holds or is offered the role", () => {
	assertEquals(
		archiveBlock({ memberCount: 3 }, 0),
		"3 members hold this role — move them all to another role first.",
	);
	assertEquals(
		archiveBlock({ memberCount: 1 }, 2),
		"1 member holds this role — move them to another role first.",
	);
	assertEquals(
		archiveBlock({ memberCount: 0 }, 1),
		"A pending invitation offers this role — withdraw it first.",
	);
	assertEquals(
		archiveBlock({ memberCount: 0 }, 2),
		"2 pending invitations offer this role — withdraw them first.",
	);
	assertStrictEquals(archiveBlock({ memberCount: 0 }, 0), null);
	const invites = [invite("i1", "r-designer"), invite("i2", "r-admin")];
	assertEquals(invitesOffering("r-designer", invites), 1);
	// The visible line: the count and the remedy, short enough for a menu row.
	assertEquals(archiveHint({ memberCount: 3 }, 0), "3 members hold it — move them first.");
	assertEquals(archiveHint({ memberCount: 1 }, 2), "1 member holds it — move them first.");
	assertEquals(archiveHint({ memberCount: 0 }, 1), "A pending invitation offers it.");
	assertEquals(archiveHint({ memberCount: 0 }, 2), "2 pending invitations offer it.");
	assertEquals(archiveHint({ memberCount: 0 }, 0), ARCHIVE_HINT);
	for (const [held, offered] of [[3, 0], [1, 2], [0, 1], [0, 2]]) {
		const line = archiveHint({ memberCount: held }, offered);
		assert(line.length <= 37, `"${line}" fits a menu row`);
	}
});

Deno.test("archive: the detail's own invitation count wins — a role manager may read no queue", () => {
	const scout = { ...role("r-scout", null, "member", [], "Scout", 0), pendingInvites: 2 };
	// A manage_roles holder without invite_members reads an empty queue, but the count is theirs.
	assertEquals(pendingInvitesFor(scout, []), 2);
	assertEquals(roleMenuRows(scout, viewer("owner"), []).at(-1), {
		action: "archive",
		disabledReason: "2 pending invitations offer this role — withdraw them first.",
		hint: "2 pending invitations offer it.",
	});
	// The count says none: the queue is not consulted over it.
	assertEquals(pendingInvitesFor({ ...scout, pendingInvites: 0 }, [invite("i1", "r-scout")]), 0);
	// A read that carries no count falls back to the queue.
	const { pendingInvites: _gone, ...legacy } = scout;
	assertEquals(pendingInvitesFor(legacy, [invite("i1", "r-scout")]), 1);
});

Deno.test("menu items: Archive is danger, after a separator, refused in place — never hidden", () => {
	const calls: string[] = [];
	const held = role("r-held", null, "member", ["view_analytics"], "Held", 2);
	const items = roleMenu(held, viewer("owner"), [], (action, r) => calls.push(`${action}:${r.id}`));
	assertEquals(items.map((i) => i.key ?? (i.separator ? "—" : "?")), [
		"rename",
		"duplicate",
		"—",
		"archive",
	]);
	const archive = items.at(-1)!;
	assert(archive.danger && archive.disabled);
	assertEquals(
		archive.disabledReason,
		"2 members hold this role — move them all to another role first.",
	);
	// The count is on the row itself, not only in its tooltip.
	assertEquals(archive.hint, "2 members hold it — move them first.");
	assertStrictEquals(archive.command, undefined);
	const free = roleMenu(
		byId("r-designer"),
		viewer("owner"),
		[],
		(action, r) => calls.push(`${action}:${r.id}`),
	);
	assertEquals(free.at(-1)?.hint, ARCHIVE_HINT);
	assertEquals(free.find((i) => i.key === "rename")?.hint, undefined);
	const evt = { item: {}, originalEvent: new Event("click") };
	free.forEach((i) => i.command?.(evt));
	assertEquals(calls, ["rename:r-designer", "duplicate:r-designer", "archive:r-designer"]);
});
// #endregion

// #region Role editor
Deno.test("templates: Contributor is data — base member, view_analytics, team only", () => {
	const contributor = ROLE_TEMPLATES.find((t) => t.key === "contributor");
	assertEquals(contributor?.basePreset, "member");
	assertEquals(contributor?.capabilities, ["view_analytics"]);
	// "manage_projects read-only" maps to no grant: reading projects is every member's already.
	assert(!contributor?.capabilities.includes("manage_projects"));
	assertEquals(templatesForKind("team").map((t) => t.key), ["contributor"]);
	// A further template is a row, not code.
	const more: RoleTemplate[] = [
		...ROLE_TEMPLATES,
		{
			key: "reader",
			name: "Reader",
			summary: "Reads.",
			basePreset: "member",
			capabilities: ["view_analytics", "bind_seat"],
			kinds: ["business"],
		},
	];
	const points = startPoints("business", [], more);
	assertEquals(points.map((p) => p.key), [
		BLANK_START,
		"template:project_manager",
		"template:observer",
		"template:reader",
	]);
	// Its capabilities are scoped to the kind (a business never carries bind_seat).
	assertEquals(points[3].capabilities, ["view_analytics"]);
});

/** A business's admin preset, as the business kind renders it. */
const BUSINESS_ADMIN = presetCapabilities("admin", "business");

Deno.test("templates: a business offers Project Manager and Observer — data, never presets (#230 (b))", () => {
	assertEquals(templatesForKind("business").map((t) => t.key), ["project_manager", "observer"]);
	const pm = ROLE_TEMPLATES.find((t) => t.key === "project_manager")!;
	const observer = ROLE_TEMPLATES.find((t) => t.key === "observer")!;
	// Project Manager: PRODUCT_SPEC's remit on a Member rank (#249 (a)) — it creates projects, hires
	// and approves the work, and funds it from the pool; it takes a manager seat by managing projects.
	assertEquals(pm.basePreset, "member");
	assertEquals(pm.kinds, ["business"]);
	assert(pm.capabilities.every((c) => BUSINESS_ADMIN.includes(c)), "nothing past the admin set");
	assertEquals(pm.capabilities, [
		"manage_projects",
		"purchase",
		"hire",
		"contribute_funds",
		"spend_funds",
		"view_analytics",
	]);
	assert(isBusinessManagerRole(pm), "a Project Manager takes a business_managers seat");
	// No people, role, settings or audit rights, and nothing that runs the wallet's policy.
	for (
		const withheld of [
			"invite_members",
			"remove_members",
			"manage_roles",
			"edit_profile",
			"manage_settings",
			"view_audit",
			"manage_finances",
			"approve_spend",
		] as const
	) {
		assert(!pm.capabilities.includes(withheld), `${withheld} is not the Project Manager's`);
	}
	// Never an owner-reserved right — the role door refuses any (#238).
	for (const reserved of ["withdraw_funds", "manage_billing", "archive_entity"] as const) {
		assert(!pm.capabilities.includes(reserved));
	}
	// Observer: base Member, View analytics alone — it drops the Member preset's Add funds.
	assertEquals(observer.basePreset, "member");
	assertEquals(observer.capabilities, ["view_analytics"]);
	assertEquals(observer.kinds, ["business"]);
	// Both summaries fit the role's 160-character summary column (upsert_workspace_role).
	for (const t of [pm, observer]) assert(t.summary.length <= 160, `${t.key}: ${t.summary.length}`);
	// Every listed capability is one the business kind renders.
	const businessCaps = capabilitiesForKind("business");
	assert([...pm.capabilities, ...observer.capabilities].every((c) => businessCaps.includes(c)));
});

/**
 * The words a template's summary must use for each consequential capability it carries — the summary
 * is written to the new role and read as its remit, so it says the rights that matter honestly.
 */
const SUMMARY_NAMES: Readonly<Record<string, RegExp>> = {
	bind_seat: /\bseat/i,
	spend_funds: /\bspend/i,
	withdraw_funds: /\bwithdraw/i,
	approve_spend: /\bapprov\w* spend/i,
	manage_billing: /\bbill/i,
	manage_roles: /\broles?\b/i,
	archive_entity: /\barchiv/i,
};

Deno.test("templates: a summary names every consequential right its template carries", () => {
	assertEquals(Object.keys(SUMMARY_NAMES).sort(), [...CONSEQUENTIAL].sort(), "one rule each");
	for (const t of ROLE_TEMPLATES) {
		for (const c of t.capabilities.filter((c) => CONSEQUENTIAL.includes(c))) {
			assert(SUMMARY_NAMES[c].test(t.summary), `${t.key}: its summary never says ${c}`);
		}
	}
	// And a summary that disclaims a right is not carrying it.
	const pm = ROLE_TEMPLATES.find((t) => t.key === "project_manager")!;
	assert(/no members, roles or policy/.test(pm.summary));
	assert(!pm.capabilities.includes("manage_roles"));
});

Deno.test("templates: the business start points carry the template's list, labelled as a template", () => {
	const points = startPoints("business", []);
	const pm = startPointOf(points, "template:project_manager");
	assertEquals(pm.label, "Project Manager template");
	assertEquals(pm.name, "Project Manager");
	assertEquals(pm.basePreset, "member");
	const observer = startPointOf(points, "template:observer");
	assertEquals(observer.label, "Observer template");
	assertEquals(observer.capabilities, ["view_analytics"]);
	// A team still offers only the Contributor template.
	assertEquals(
		startPoints("team", []).filter((p) => p.key.startsWith("template:")).map((p) => p.key),
		["template:contributor"],
	);
});

Deno.test("templates: a seed passes grant-what-you-hold — whole for an owner or admin, clamped below", () => {
	const points = startPoints("business", []);
	const pmPoint = startPointOf(points, "template:project_manager");
	const pm = ROLE_TEMPLATES.find((t) => t.key === "project_manager")!;
	// The owner and an admin hold every capability on the list, and member is within their rank.
	for (const preset of ["owner", "admin"] as const) {
		const author = viewer(preset, "business");
		const seed = seedFrom(pmPoint, author);
		assertEquals(seed.dropped, [], preset);
		assertEquals([...seed.capabilities].sort(), [...pm.capabilities].sort(), preset);
		assertEquals(seed.basePreset, "member", preset);
		assert(seed.capabilities.every((c) => author.caps.includes(c)));
	}
	// A member author holding Change roles beside the Member preset: the seed keeps only what they
	// hold and ranks the role as theirs — the set the probe writes through the real door (1j).
	const memberAuthor = {
		kind: "business" as const,
		caps: [...presetCapabilities("member", "business"), "manage_roles"] as WorkspaceCapability[],
		rank: roleRank("member"),
	};
	const clamped = seedFrom(pmPoint, memberAuthor);
	assertEquals(clamped.capabilities, ["contribute_funds", "view_analytics"]);
	assertEquals(clamped.basePreset, "member");
	assertEquals(clamped.dropped, ["manage_projects", "purchase", "hire", "spend_funds"]);
	assertEquals(
		seedFrom(startPointOf(points, "template:observer"), memberAuthor),
		{ capabilities: ["view_analytics"], dropped: [], basePreset: "member" },
	);
});

Deno.test("templates: the probe's copies of the two business lists match role-templates.ts", () => {
	const probe = Deno.readTextFileSync(
		new URL("../../../../../supabase/probes/business_members_roles.sql", import.meta.url),
	);
	const listAfter = (marker: string) => {
		const at = probe.indexOf(marker);
		assert(at >= 0, `the probe has no ${marker} list`);
		const array = /ARRAY\[([^\]]*)\]/.exec(probe.slice(at));
		assert(array, `${marker}: no ARRAY`);
		return [...array[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
	};
	for (const key of ["project_manager", "observer"]) {
		const template = ROLE_TEMPLATES.find((t) => t.key === key)!;
		assertEquals(listAfter(`-- template:${key}`), [...template.capabilities], key);
		// The marker names the rank the probe writes it with — the template's own.
		const marker = probe.slice(probe.indexOf(`-- template:${key}`)).split("\n")[0];
		assert(marker.includes(`(base ${template.basePreset})`), `${key}: ${marker}`);
	}
});

Deno.test("start points: nothing, the kind's templates, then a copy of every role, presets first", () => {
	const points = startPoints("team", ROLES);
	assertEquals(points.map((p) => p.key), [
		BLANK_START,
		"template:contributor",
		"role:r-owner",
		"role:r-admin",
		"role:r-lead",
		"role:r-member",
		"role:r-designer",
		"role:r-treasurer",
	]);
	assertEquals(points[0].capabilities, []);
	assertEquals(points[1].label, "Contributor template");
	assertEquals(points[1].name, "Contributor");
	const owner = startPointOf(points, "role:r-owner");
	assertEquals(owner.label, "Same as Owner");
	assertEquals(owner.name, "Owner copy");
	assertEquals([...owner.capabilities].sort(), [...capabilitiesForKind("team")].sort());
	assertEquals(startPointOf(points, "nope").key, BLANK_START);
});

Deno.test("ranks: never owner, never above the author, no lead on a business", () => {
	assertEquals(baseOptions("team", 4), ["admin", "lead", "member"]);
	assertEquals(baseOptions("team", 3), ["admin", "lead", "member"]);
	assertEquals(baseOptions("team", 2), ["lead", "member"]);
	assertEquals(baseOptions("business", 4), ["admin", "member"]);
	assertEquals(clampBase("owner", baseOptions("team", 4)), "admin");
	assertEquals(clampBase("admin", baseOptions("team", 2)), "lead");
	assertEquals(clampBase("lead", baseOptions("business", 4)), "member");
	assertEquals(clampBase("member", []), "member");
});

Deno.test("seed: only what the author may grant, the rest named; the rank clamped to theirs", () => {
	const points = startPoints("team", ROLES);
	const lead = viewer("lead");
	const copyOfAdmin = seedFrom(startPointOf(points, "role:r-admin"), lead);
	assert(copyOfAdmin.capabilities.every((c) => LEAD_CAPS.includes(c)));
	assert(copyOfAdmin.dropped.includes("manage_roles"));
	assertEquals(copyOfAdmin.basePreset, "lead");
	assertEquals(
		seedNote(["manage_roles"], "team"),
		"Change roles is left out — you can't grant what you don't hold.",
	);
	// A business owner copying their own preset still never puts a reserved right on a role.
	const businessRoles = [
		role("b-owner", "owner", "owner", presetCapabilities("owner", "business")),
	];
	const businessOwner = viewer("owner", "business");
	const own = seedFrom(
		startPointOf(startPoints("business", businessRoles), "role:b-owner"),
		businessOwner,
	);
	assertEquals(own.dropped, ["withdraw_funds", "manage_billing", "archive_entity"]);
	assertEquals(own.basePreset, "admin");
	assertEquals(
		seedNote(own.dropped, "business"),
		"Withdraw funds, Manage billing and Archive entity are left out — the owner gives them to a named admin, never to a role.",
	);
	assertStrictEquals(seedNote([], "team"), null);
	// The Contributor template seeds cleanly for any author holding view_analytics.
	const contributor = seedFrom(startPointOf(points, "template:contributor"), lead);
	assertEquals(contributor, {
		capabilities: ["view_analytics"],
		dropped: [],
		basePreset: "member",
	});
});

Deno.test("name: required, bounded, unique ignoring case — a rename may keep its own", () => {
	assertEquals(roleNameProblem("  ", ROLES), "Give the role a name.");
	assertEquals(
		roleNameProblem("x".repeat(ROLE_NAME_MAX + 1), ROLES),
		"Keep the name to 48 characters.",
	);
	assertStrictEquals(roleNameProblem("x".repeat(ROLE_NAME_MAX), ROLES), null);
	assertEquals(roleNameProblem("designer", ROLES), "There is already a role called Designer.");
	assertEquals(roleNameProblem(" ADMIN ", ROLES), "There is already a role called Admin.");
	assertStrictEquals(roleNameProblem("Designer", ROLES, "r-designer"), null);
	assertStrictEquals(roleNameProblem("Purchaser", ROLES), null);
});

Deno.test("editor input: create sends the seed; rename keeps the role's capabilities and summary", () => {
	const ws = { kind: "team" as const, id: "ws-1" };
	assertEquals(
		roleEditorInput(ws, {
			mode: "create",
			name: "  Contributor ",
			basePreset: "member",
			seed: { capabilities: ["view_analytics"], summary: "Delivers." },
		}),
		{
			kind: "team",
			workspaceId: "ws-1",
			name: "Contributor",
			basePreset: "member",
			summary: "Delivers.",
			capabilities: ["view_analytics"],
		},
	);
	assertEquals(
		roleEditorInput(ws, {
			mode: "rename",
			name: "Designers",
			basePreset: "member",
			role: byId("r-designer"),
		}),
		{
			kind: "team",
			workspaceId: "ws-1",
			name: "Designers",
			basePreset: "member",
			roleId: "r-designer",
			summary: "Designer summary",
			capabilities: ["publish_listings", "view_analytics"],
		},
	);
});

Deno.test("editor copy: the example name fits the kind; the intro and notice follow the start", () => {
	// purchase is a business's alone, so a team is never shown a Purchaser.
	assertEquals(ROLE_NAME_EXAMPLE, { team: "Designer", business: "Purchaser" });
	assert(!capabilitiesForKind("team").includes("purchase"));
	// Nothing yet: tick its column once it exists.
	assertEquals(
		roleEditorIntro("create", "team", []),
		"A custom role is a named bundle of permissions for this team. Tick what it may do in its " +
			"column once it exists.",
	);
	// The Contributor template already carries View analytics — the intro says so instead.
	const owner = viewer("owner");
	const points = startPoints("team", ROLES);
	const contributor = seedFrom(startPointOf(points, "template:contributor"), owner);
	assertEquals(
		roleEditorIntro("create", "team", contributor.capabilities),
		"A custom role is a named bundle of permissions for this team. It starts with View " +
			"analytics — change its column any time.",
	);
	// A copy of a large role: a count, not a wall of names.
	const admin = seedFrom(startPointOf(points, "role:r-admin"), owner);
	assert(admin.capabilities.length > 3);
	assert(
		roleEditorIntro("create", "team", admin.capabilities).includes(
			`It starts with ${admin.capabilities.length} permissions`,
		),
	);
	assertEquals(
		roleEditorIntro("rename", "business", ["purchase"]),
		"Its permissions and the people holding it stay as they are.",
	);
	assertEquals(
		roleCreatedNotice("Scout", []),
		"Scout is created. Tick what it may do in its column, then save.",
	);
	assertEquals(
		roleCreatedNotice("Contributor", contributor.capabilities),
		"Contributor is created with View analytics. Change its column any time, then save.",
	);
});
// #endregion

// #region Buttons
Deno.test("buttons: the editor holds one filled control — Create role tier 2, Save role tier 3", () => {
	for (const saving of [false, true]) {
		const create = roleEditorFooter("create", saving);
		const rename = roleEditorFooter("rename", saving);
		assertEquals(rolesFilledCount(create), 1);
		assertEquals(rolesFilledCount(rename), 1);
		assertEquals(create[0], { key: "cancel", label: "Cancel", tier: 5, disabled: saving });
		assertEquals(create[1].tier, 2);
		assertEquals(rename[1].tier, 3);
		assertEquals(create[1].busy, saving);
	}
	assertEquals(roleEditorFooter("create", false)[1].label, "Create role");
	assertEquals(roleEditorFooter("create", true)[1].label, "Creating…");
	assertEquals(roleEditorFooter("rename", false)[1].label, "Save role");
});

Deno.test("buttons: tiers draw the matrix's tones; the header's New role is tier 2 for manage_roles", () => {
	assertEquals(rolesTierProps(2), { structural: true });
	assertEquals(rolesTierProps(3), { variant: "filled" });
	assertEquals(rolesTierProps(4), { severity: "neutral", variant: "outlined" });
	assertEquals(rolesTierProps(5), { variant: "text" });
	assertEquals(rolesCommit(viewer("owner")), { key: "new-role", label: "New role", tier: 2 });
	assertStrictEquals(rolesCommit(viewer("member")), null);
});

Deno.test("viewer: rank from the viewer's own row, capabilities from the server", () => {
	const v = rolesViewerOf({
		kind: "team",
		viewerCapabilities: LEAD_CAPS,
		members: [member("m-1", "owner"), member("m-2", "lead")],
		viewerMemberId: "m-2",
	});
	assertEquals(v.rank, 2);
	assertEquals(v.canManage, false);
	assertEquals(v.caps, LEAD_CAPS);
	assertEquals(
		rolesViewerOf({ kind: "team", viewerCapabilities: [], members: [], viewerMemberId: "x" }).rank,
		0,
	);
});
// #endregion

// #region Manager cap (BU7)
/** A business's roles: two member-ranked custom roles somebody holds, and one nobody holds. */
const B_ROLES: WorkspaceRoleDef[] = [
	role("b-owner", "owner", "owner", presetCapabilities("owner", "business")),
	role("b-admin", "admin", "admin", BUSINESS_ADMIN),
	role("b-member", "member", "member", presetCapabilities("member", "business"), undefined, 2),
	{ ...role("b-buyers", null, "member", ["purchase"], "Buyers", 2), pendingInvites: 1 },
	role("b-scouts", null, "member", ["view_analytics"], "Scouts", 1),
	role("b-empty", null, "member", ["view_analytics"], "Empty", 0),
];

const bRole = (id: string) => B_ROLES.find((r) => r.id === id)!;

/** Helia at a headroom: the owner, an admin, two buyers (one granted Manage projects), one scout. */
function capContext(used: number, limit: number | null, extra: Partial<RoleCapContext> = {}) {
	const at = (
		id: string,
		roleId: string,
		preset: WorkspaceRole,
		granted: WorkspaceCapability[] = [],
	) => ({
		...member(id, preset),
		roleId,
		overrides: { granted, revoked: [] },
	});
	return {
		kind: "business",
		managers: { used, limit },
		members: [
			at("m-owner", "b-owner", "owner"),
			at("m-admin", "b-admin", "admin"),
			at("m-buyer", "b-buyers", "member"),
			at("m-buyer-pm", "b-buyers", "member", ["manage_projects"]),
			at("m-scout", "b-scouts", "member"),
		],
		queue: null,
		now: 0,
		text: "Helia Finance's plan allows 2 managers.",
		...extra,
	} satisfies RoleCapContext;
}

const B_OWNER_VIEWER = viewer("owner", "business");

Deno.test("manager cap: a role edit counts the holders whose seat changes and the invitations offering it", () => {
	const ctx = capContext(2, 3);
	// Manage projects on Buyers: one holder becomes a manager (the other already is one, by a grant),
	// and its pending invitation starts to count — two seats.
	assertEquals(managerDelta(bRole("b-buyers"), ["manage_projects", "purchase"], ctx), 2);
	// Taking it away again frees them.
	const pmBuyers = {
		...bRole("b-buyers"),
		capabilities: ["manage_projects", "purchase"],
	} as WorkspaceRoleDef;
	assertEquals(managerDelta(pmBuyers, ["purchase"], ctx), -2);
	// A role nobody holds or is offered takes no seat; a change that leaves manager-ness alone takes none.
	assertEquals(managerDelta(bRole("b-empty"), ["manage_projects", "view_analytics"], ctx), 0);
	assertEquals(managerDelta(bRole("b-buyers"), ["purchase", "hire"], ctx), 0);
	// A revocation wins over the role: a holder who has Manage projects revoked never counts.
	const revoked = capContext(2, 3, {
		members: [{
			...member("m-r", "member"),
			roleId: "b-scouts",
			overrides: { granted: [], revoked: ["manage_projects"] },
		}],
	});
	assertEquals(managerDelta(bRole("b-scouts"), ["manage_projects", "view_analytics"], revoked), 0);
	// The queue, when the viewer reads it, counts only unexpired invitations; a team never counts.
	const lapsed = { ...invite("i-old", "b-buyers"), expiresAt: "2026-01-01T00:00:00Z" };
	const queued = capContext(2, 3, { queue: [lapsed], now: Date.parse("2026-10-19T00:00:00Z") });
	assertEquals(managerDelta(bRole("b-buyers"), ["manage_projects", "purchase"], queued), 1);
	assertEquals(
		managerDelta(bRole("b-buyers"), ["manage_projects", "purchase"], { ...ctx, kind: "team" }),
		0,
	);
});

Deno.test("manager cap: the cell that would pass the ceiling is locked with the cap's sentence", () => {
	// 2 of 3: ticking Manage projects on Buyers would make it 4 — locked; on Scouts it makes 3 — free.
	const ctx = capContext(2, 3);
	assertEquals(
		managerCapLock(bRole("b-buyers"), "manage_projects", false, B_ROLES, {}, ctx),
		ctx.text,
	);
	assertStrictEquals(
		managerCapLock(bRole("b-scouts"), "manage_projects", false, B_ROLES, {}, ctx),
		null,
	);
	// Once Scouts is ticked in the draft, the headroom is spent — Buyers stays locked, and so would a
	// second tick anywhere that adds a manager.
	const draft = toggleRoleCap({}, bRole("b-scouts"), "manage_projects");
	assertEquals(draftManagersUsed(B_ROLES, draft, ctx), 3);
	assertEquals(
		managerCapLock(bRole("b-buyers"), "manage_projects", false, B_ROLES, draft, ctx),
		ctx.text,
	);
	// A role nobody holds is never locked; nor is a cell that adds no manager, nor taking one away.
	assertStrictEquals(
		managerCapLock(bRole("b-empty"), "manage_projects", false, B_ROLES, draft, ctx),
		null,
	);
	assertStrictEquals(managerCapLock(bRole("b-buyers"), "hire", false, B_ROLES, draft, ctx), null);
	assertStrictEquals(
		managerCapLock(bRole("b-scouts"), "manage_projects", true, B_ROLES, draft, ctx),
		null,
	);
	// Nothing caps managers (gates off, unlimited) or a team: never locked.
	assertStrictEquals(
		managerCapLock(bRole("b-buyers"), "manage_projects", false, B_ROLES, {}, capContext(2, null)),
		null,
	);
	assertStrictEquals(draftManagersUsed(B_ROLES, draft, capContext(2, null)), null);
	// The matrix knows a cell is capped, and the legend says what its missing box means.
	assert(managerCapLocked(B_ROLES, B_OWNER_VIEWER, {}, ctx));
	assert(!managerCapLocked(B_ROLES, B_OWNER_VIEWER, {}, capContext(0, 15)), "headroom to spare");
	assert(!managerCapLocked(B_ROLES, { ...B_OWNER_VIEWER, canManage: false }, {}, ctx), "read-only");
	const legend = (capped: boolean) =>
		rolesLegend({
			kind: "business",
			conditional: false,
			columnLocks: [],
			fixedReasons: [],
			capped,
		});
	assertEquals(legend(true).at(-1), { mark: "capped", text: CAPPED_LEGEND });
	assertEquals(legend(false).map((i) => i.mark), ["allowed"]);
	assertEquals(
		rolesLegend({
			kind: "team",
			conditional: false,
			columnLocks: [],
			fixedReasons: [],
			capped: true,
		})
			.map((i) => i.mark),
		["allowed"],
		"a team has no manager cap",
	);
});

Deno.test("manager cap: Save holds back the write that would pass the ceiling, in Save's order", () => {
	const ctx = capContext(2, 3);
	// Buyers (+2) and Scouts (+1) ticked, saved in that order: Buyers would make it 4 of 3, so it is
	// held back; Scouts still fits (3 of 3).
	let draft = toggleRoleCap({}, bRole("b-buyers"), "manage_projects");
	draft = toggleRoleCap(draft, bRole("b-scouts"), "manage_projects");
	const plan = roleSavePlan(B_ROLES, draft, B_OWNER_VIEWER, ctx);
	assertEquals(plan.writes.map((w) => w.role.id), ["b-scouts"]);
	assertEquals(plan.problems, [{ roleId: "b-buyers", text: managerCapLine("Buyers", 2, ctx) }]);
	assertEquals(
		managerCapLine("Buyers", 2, ctx),
		"Saving Buyers would add 2 managers. Helia Finance's plan allows 2 managers.",
	);
	// With headroom, or nothing capping managers, or without the context, both save.
	assertEquals(roleSavePlan(B_ROLES, draft, B_OWNER_VIEWER, capContext(0, 15)).problems, []);
	assertEquals(roleSavePlan(B_ROLES, draft, B_OWNER_VIEWER, capContext(2, null)).problems, []);
	assertEquals(roleSavePlan(B_ROLES, draft, B_OWNER_VIEWER).writes.length, 2);
	// A write that frees seats leaves them to the writes after it (the server judges each in turn).
	const pmScouts: WorkspaceRoleDef = {
		...bRole("b-scouts"),
		capabilities: ["manage_projects", "view_analytics"],
	};
	const freeing = [pmScouts, ...B_ROLES.filter((r) => r.id !== "b-scouts")];
	let swap = toggleRoleCap({}, freeing.find((r) => r.id === "b-scouts")!, "manage_projects");
	swap = toggleRoleCap(swap, bRole("b-buyers"), "manage_projects");
	const full = capContext(3, 4);
	assertEquals(
		roleSavePlan(freeing, swap, B_OWNER_VIEWER, full).problems.length,
		0,
		"3 - 1 + 2 = 4",
	);
});
// #endregion
