import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import {
	capabilitiesForKind,
	CONSEQUENTIAL,
	presetCapabilities,
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
	archiveBlock,
	baseOptions,
	BLANK_START,
	cellLock,
	clampBase,
	columnLock,
	dirtyRoleIds,
	GRANT_LOCK,
	invitesOffering,
	mayGrantToRole,
	orderedRoles,
	PRESET_LOCK,
	pruneDraft,
	RANK_LOCK,
	renameBlock,
	RESERVED_LOCK,
	ROLE_NAME_MAX,
	roleCaps,
	roleCellState,
	roleColumnMeta,
	type RoleDraft,
	roleEditorFooter,
	roleEditorInput,
	roleMatrixColumns,
	roleMatrixRows,
	roleMenu,
	roleMenuRows,
	roleNameProblem,
	roleSavePlan,
	rolesCommit,
	rolesFilledCount,
	rolesHeaderItems,
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

Deno.test("columns: the meta line counts holders, names a custom role's base and an unsaved edit", () => {
	assertEquals(roleColumnMeta(byId("r-member"), false), "3 members");
	assertEquals(roleColumnMeta(byId("r-owner"), false), "1 member");
	assertEquals(roleColumnMeta(byId("r-designer"), false), "0 members · based on Lead");
	assertEquals(roleColumnMeta(byId("r-designer"), true), "0 members · based on Lead · edited");
	const draft = toggleRoleCap({}, byId("r-designer"), "manage_projects");
	const cols = roleMatrixColumns(ROLES, viewer("owner"), draft);
	assertEquals(
		cols.find((c) => c.key === "r-designer")?.meta,
		"0 members · based on Lead · edited",
	);
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
	});
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
	assertStrictEquals(archive.command, undefined);
	const free = roleMenu(
		byId("r-designer"),
		viewer("owner"),
		[],
		(action, r) => calls.push(`${action}:${r.id}`),
	);
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
	assertEquals(templatesForKind("business"), []);
	// A further template is a row, not code.
	const more: RoleTemplate[] = [
		...ROLE_TEMPLATES,
		{
			key: "observer",
			name: "Observer",
			summary: "Reads.",
			basePreset: "member",
			capabilities: ["view_analytics", "bind_seat"],
			kinds: ["business"],
		},
	];
	const points = startPoints("business", [], more);
	assertEquals(points.map((p) => p.key), [BLANK_START, "template:observer"]);
	// Its capabilities are scoped to the kind (a business never carries bind_seat).
	assertEquals(points[1].capabilities, ["view_analytics"]);
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
