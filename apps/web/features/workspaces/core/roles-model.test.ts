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
import { CAPABILITY_GROUPS, capabilityGroupsFor, type PolicyContext } from "./capabilities.ts";
import { sensitiveWarning } from "./members-model.ts";
import { ROLE_TEMPLATES, type RoleTemplate, templatesForKind } from "./role-templates.ts";
import {
	allowedText,
	ARCHIVE_HINT,
	archiveBlock,
	archiveHint,
	baseOptions,
	BLANK_START,
	BUSY_LOCK,
	canvasMeta,
	capabilityLine,
	cellLock,
	clampBase,
	cloneHint,
	cloneOptionGroups,
	createdRoleId,
	CUSTOM_EMPTY,
	dirtyRoleIds,
	draftManagersUsed,
	EDIT_BLOCKED_HINT,
	editBlock,
	GRANT_LOCK,
	initialRoleId,
	invitesOffering,
	keepSelection,
	managerCapLine,
	managerCapLock,
	managerDelta,
	mayGrantToRole,
	newRoleAction,
	orderedRoles,
	pendingInvitesFor,
	PRESET_LOCK,
	pruneDraft,
	RANK_LOCK,
	rankCapProblem,
	RESERVED_LOCK,
	rigActions,
	ROLE_NAME_EXAMPLE,
	ROLE_NAME_MAX,
	ROLE_SUMMARY_MAX,
	roleActionRows,
	roleCanvas,
	type RoleCapContext,
	roleCreatedNotice,
	type RoleDraft,
	roleEditorFooter,
	roleEditorInput,
	roleEditorIntro,
	roleLock,
	roleNameProblem,
	ROLES_AUTOSAVE_MS,
	roleSavePlan,
	rolesFilledCount,
	rolesSaveLabel,
	rolesScreenCopy,
	rolesTierProps,
	roleSummaryLine,
	roleSummaryProblem,
	type RolesViewer,
	rolesViewerOf,
	roleWriteInput,
	rosterSections,
	savedAgo,
	seedFrom,
	seedNote,
	startPointOf,
	startPoints,
	toggleRoleCap,
	VIEW_LOCK,
} from "./roles-model.ts";

/**
 * The Roles module's rules (Decision #320, rebuilding Teams work order C3): the four capability
 * domains, the roster (presets, then custom roles) and the role it opens on, the capability canvas
 * (the kind's own capability list, what a role allows, the rule bounding it), every lock the server
 * would otherwise refuse on press — with its reason — the draft and the footer rig's Save, the header's
 * actions and the archive refusal, and the role dialogs' clone sources (the templates are data), ranks,
 * seed, name and description checks and one filled control per region.
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

// #region Domains
/** The manager-cap context of a team — nothing caps it. */
const TEAM_CAP: RoleCapContext = {
	kind: "team",
	managers: null,
	members: [],
	queue: null,
	now: 0,
	text: "",
};

const KINDS: WorkspaceKind[] = ["team", "business"];

Deno.test("domains: every capability sits in exactly one of the four domains", () => {
	assertEquals(CAPABILITY_GROUPS.map((g) => g.key), ["people", "work", "money", "admin"]);
	const listed = CAPABILITY_GROUPS.flatMap((g) => g.capabilities);
	assertEquals(listed.length, new Set(listed).size, "a capability in two domains");
	assertEquals([...listed].sort(), [...CapabilityEnum.options].sort(), "a capability in no domain");
});

Deno.test("domains: worded for the kind — a team delivers from a vault, a business buys from a wallet", () => {
	assertEquals(capabilityGroupsFor("team").map((g) => g.title), [
		"People & access",
		"Projects & delivery",
		"Vault & financial governance",
		"Workspace & oversight",
	]);
	assertEquals(capabilityGroupsFor("business").map((g) => g.title), [
		"People & access",
		"Projects & purchasing",
		"Wallet & financial governance",
		"Workspace & oversight",
	]);
	for (const kind of KINDS) {
		for (const g of capabilityGroupsFor(kind)) assert(g.description.endsWith("."), g.key);
	}
});
// #endregion

// #region Roster
Deno.test("roster: presets most-privileged first, then custom roles in the server's order", () => {
	assertEquals(orderedRoles(ROLES).map((r) => r.id), [
		"r-owner",
		"r-admin",
		"r-lead",
		"r-member",
		"r-designer",
		"r-treasurer",
	]);
	const [presets, custom] = rosterSections(ROLES, {});
	assertEquals([presets.title, custom.title], ["Preset roles", "Custom roles"]);
	assertEquals(presets.rows.map((r) => r.id), ["r-owner", "r-admin", "r-lead", "r-member"]);
	assertEquals(custom.rows.map((r) => r.id), ["r-designer", "r-treasurer"]);
	assertStrictEquals(presets.empty, null);
	assertEquals(custom.empty, CUSTOM_EMPTY);
	assertEquals(presets.rows[3], {
		id: "r-member",
		name: "Member",
		preset: "member",
		memberCount: 3,
		countText: "3 members",
		edited: false,
	});
	// A role holding unsaved edits says so in its row; a preset never does.
	const draft = toggleRoleCap({}, byId("r-designer"), "manage_projects");
	assertEquals(
		rosterSections(ROLES, draft)[1].rows.map((r) => r.edited),
		[true, false],
	);
	// An entity with no custom roles yet: the run is empty and says how to start one.
	assertEquals(rosterSections([byId("r-owner")], {})[1].rows, []);
});

Deno.test("roster: a role with no written summary says what it allows, on its kind", () => {
	const line = (capabilities: WorkspaceCapability[], summary = "  ") =>
		roleSummaryLine({ summary, preset: null, capabilities }, "team");
	assertEquals(line([]), "No permissions yet — a seat and nothing more.");
	assertEquals(line(["view_analytics"]), "Can view analytics.");
	assertEquals(
		line(["publish_listings", "view_analytics"]),
		"Can publish listings and view analytics.",
	);
	assertEquals(
		line(["invite_members", "manage_projects", "publish_listings", "view_analytics"]),
		"Can invite members, manage projects and 2 more.",
	);
	// A capability the kind never renders is never named.
	assertEquals(line(["purchase", "view_analytics"]), "Can view analytics.");
	// The written summary wins; the owner holds everything the kind renders.
	assertEquals(line(["view_analytics"], " Reads. "), "Reads.");
	const team = capabilitiesForKind("team").length;
	assertEquals(
		roleSummaryLine({ summary: "", preset: "owner", capabilities: [] }, "team"),
		`Can invite members, remove members and ${team - 2} more.`,
	);
});

Deno.test("roster: opens on the first custom role, else the first preset below the owner", () => {
	assertEquals(initialRoleId(ROLES), "r-designer");
	assertEquals(initialRoleId(ROLES.filter((r) => r.preset !== null)), "r-admin");
	assertEquals(initialRoleId([byId("r-owner")]), "r-owner");
	assertStrictEquals(initialRoleId([]), null);
	// A re-read keeps the selection while the role exists, else falls back.
	assertEquals(keepSelection(ROLES, "r-lead", () => "r-designer"), "r-lead");
	assertEquals(keepSelection(ROLES, "r-gone", () => "r-designer"), "r-designer");
	assertStrictEquals(keepSelection(ROLES, null, () => null), null);
	// The role a create wrote is the one id the re-read has that the old read did not.
	const created = role("r-new", null, "member", [], "Scout", 0);
	assertEquals(createdRoleId(ROLES, [...ROLES, created]), "r-new");
	assertStrictEquals(createdRoleId(ROLES, ROLES), null);
});
// #endregion

// #region Canvas
/** The canvas for one of the fixture roles, as a viewer sees it. */
function canvasFor(
	id: string,
	who: RolesViewer = viewer("owner"),
	extra: { draft?: RoleDraft; policy?: PolicyContext; roles?: WorkspaceRoleDef[] } = {},
) {
	const roles = extra.roles ?? ROLES;
	return roleCanvas({
		role: roles.find((r) => r.id === id)!,
		roles,
		draft: extra.draft ?? {},
		viewer: who,
		policy: extra.policy ?? { ...TEAM_POLICY, kind: who.kind },
		cap: TEAM_CAP,
	});
}

/** Every row of a canvas, in order. */
const rowsOf = (canvas: ReturnType<typeof canvasFor>) => canvas.domains.flatMap((d) => d.rows);

Deno.test("canvas: exactly the capabilities the kind renders, in its domains — imported, never re-listed", () => {
	for (const kind of KINDS) {
		const roles = [role("x-custom", null, "member", [], "Custom", 0)];
		const canvas = canvasFor("x-custom", viewer("owner", kind), { roles });
		assertEquals(
			rowsOf(canvas).map((r) => r.capability).sort(),
			[...capabilitiesForKind(kind)].sort(),
			kind,
		);
		assertEquals(canvas.domains.map((d) => d.key), ["people", "work", "money", "admin"], kind);
		assertEquals(canvas.total, capabilitiesForKind(kind).length, kind);
	}
	const team = rowsOf(canvasFor("r-designer")).map((r) => r.capability);
	for (const cap of ["purchase", "hire", "contribute_funds", "approve_spend", "manage_billing"]) {
		assert(!team.includes(cap as WorkspaceCapability), `a team renders ${cap}`);
	}
});

Deno.test("canvas: every row says what it does; a consequential one says its consequence and is flagged", () => {
	for (const kind of KINDS) {
		for (const cap of capabilitiesForKind(kind)) {
			const line = capabilityLine(cap, kind);
			if (CONSEQUENTIAL.includes(cap)) assertEquals(line, sensitiveWarning(cap, kind), cap);
			else assert(line.endsWith(".") && line.length > 12, `${kind} ${cap}: "${line}"`);
		}
	}
	for (const row of rowsOf(canvasFor("r-designer"))) {
		assertEquals(row.sensitive, CONSEQUENTIAL.includes(row.capability), row.capability);
		assertEquals(row.description, capabilityLine(row.capability, "team"), row.capability);
	}
});

Deno.test("canvas: on follows the draft; the owner holds everything; a rule shows only while on", () => {
	const designer = canvasFor("r-designer");
	assertEquals(
		rowsOf(designer).filter((r) => r.on).map((r) => r.capability),
		["publish_listings", "view_analytics"],
	);
	assertEquals([designer.allowed, designer.total], [2, capabilitiesForKind("team").length]);
	assertEquals(designer.domains.find((d) => d.key === "work")?.allowed, 1);
	// The draft is what the canvas draws.
	const draft = toggleRoleCap({}, byId("r-designer"), "invite_members");
	assert(
		rowsOf(canvasFor("r-designer", viewer("owner"), { draft })).find((r) =>
			r.capability === "invite_members"
		)?.on,
	);
	// A rule the entity configured (a one-person team cannot bid yet) bounds a granted capability…
	const solo = { ...TEAM_POLICY, canPropose: false };
	const lead = rowsOf(canvasFor("r-lead", viewer("owner"), { policy: solo }));
	assertEquals(
		lead.find((r) => r.capability === "bind_seat")?.rule,
		"The team needs at least two active members before it can bid for a seat.",
	);
	// …never one that is off, and never the owner's.
	assertStrictEquals(
		rowsOf(canvasFor("r-designer", viewer("owner"), { policy: solo })).find((r) =>
			r.capability === "bind_seat"
		)?.rule,
		null,
	);
	const owner = canvasFor("r-owner", viewer("owner"), { policy: solo });
	assertEquals(owner.allowed, owner.total);
	assert(rowsOf(owner).every((r) => r.on && r.rule === null));
});

Deno.test("canvas: a preset, a role above the viewer, or no Change roles — read-only, said once", () => {
	const owner = viewer("owner");
	assertEquals(roleLock(byId("r-admin"), owner), PRESET_LOCK);
	assertStrictEquals(roleLock(byId("r-designer"), owner), null);
	assertEquals(roleLock(byId("r-designer"), { ...owner, canManage: false }), VIEW_LOCK);
	// A lead granted manage_roles on top of their role: Treasurer ranks above them.
	const lead = {
		...viewer("lead"),
		caps: [...LEAD_CAPS, "manage_roles" as const],
		canManage: true,
	};
	assertEquals(roleLock(byId("r-treasurer"), lead), RANK_LOCK);
	assertStrictEquals(roleLock(byId("r-designer"), lead), null);
	// The whole-role lock is the canvas's, never repeated on its rows.
	for (
		const [id, who, lock] of [
			["r-admin", owner, PRESET_LOCK],
			["r-treasurer", lead, RANK_LOCK],
			["r-designer", { ...owner, canManage: false }, VIEW_LOCK],
		] as const
	) {
		const canvas = canvasFor(id, who);
		assertEquals(canvas.lock, lock, id);
		assert(rowsOf(canvas).every((r) => r.lock === null), id);
	}
	assert(PRESET_LOCK.includes("Clone"), "the preset's sentence names its way out");
});

Deno.test("canvas: on a role the viewer may edit, a row they may not grant says why", () => {
	const lead = {
		...viewer("lead"),
		caps: [...LEAD_CAPS, "manage_roles" as const],
		canManage: true,
	};
	const rows = rowsOf(canvasFor("r-designer", lead));
	assertEquals(rows.find((r) => r.capability === "withdraw_funds")?.lock, GRANT_LOCK);
	assertStrictEquals(
		rows.find((r) => r.capability === "view_analytics")?.lock,
		null,
		"on is removable",
	);
	assertStrictEquals(rows.find((r) => r.capability === "bind_seat")?.lock, null, "theirs to grant");
	// A team owner holds every right and a team reserves none: nothing is fixed.
	assert(rowsOf(canvasFor("r-designer")).every((r) => r.lock === null));
	// A business owner: the reserved rights are fixed on every custom role.
	const bizRoles = [
		role("b-owner", "owner", "owner", presetCapabilities("owner", "business")),
		role("b-buyer", null, "member", ["purchase"], "Purchaser"),
	];
	const biz = rowsOf(canvasFor("b-buyer", viewer("owner", "business"), { roles: bizRoles }));
	assertEquals(
		biz.filter((r) => r.lock !== null).map((r) => [r.capability, r.lock]),
		[
			["withdraw_funds", RESERVED_LOCK],
			["manage_billing", RESERVED_LOCK],
			["archive_entity", RESERVED_LOCK],
		],
	);
});

Deno.test("canvas: the header's meta names the role's kind and rank, its holders, its reach and an edit", () => {
	assertEquals(canvasMeta(byId("r-admin"), { allowed: 12, total: 14 }, false), [
		"Preset role",
		"1 member",
		"12 of 14 permissions",
	]);
	assertEquals(canvasMeta(byId("r-designer"), { allowed: 2, total: 14 }, true), [
		"Custom role · ranks as Lead",
		"0 members",
		"2 of 14 permissions",
		"Unsaved changes",
	]);
	assertEquals(allowedText(1, 1), "1 of 1 permission");
});
// #endregion

// #region Cells
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

Deno.test("cell locks: while a write is in flight every editable row waits, and says so", () => {
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

// #region Role actions
Deno.test("actions: none on a preset or without manage_roles; Edit details only on an editable role", () => {
	const owner = viewer("owner");
	assertEquals(roleActionRows(byId("r-admin"), owner, []), []);
	assertEquals(roleActionRows(byId("r-designer"), { ...owner, canManage: false }, []), []);
	assertEquals(roleActionRows(byId("r-designer"), owner, []).map((r) => r.action), [
		"edit",
		"duplicate",
		"archive",
	]);
	// A lead granted manage_roles on top of their role, on a role ranking above them: no Edit details
	// (its canvas says why); Duplicate and Archive remain.
	const lead = {
		...viewer("lead"),
		caps: [...LEAD_CAPS, "manage_roles" as const],
		canManage: true,
	};
	assertEquals(roleActionRows(byId("r-treasurer"), lead, []).map((r) => r.action), [
		"duplicate",
		"archive",
	]);
	// A role carrying what the viewer can't grant: Edit details refused in place, with the reason.
	const admin = viewer("admin");
	assertEquals(
		editBlock(byId("r-treasurer"), admin),
		"Treasurer allows Withdraw funds, which you can't give a role.",
	);
	assertEquals(roleActionRows(byId("r-treasurer"), admin, [])[0], {
		action: "edit",
		disabledReason: "Treasurer allows Withdraw funds, which you can't give a role.",
		hint: EDIT_BLOCKED_HINT,
	});
	assertStrictEquals(roleActionRows(byId("r-designer"), owner, [])[0].hint, null);
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
	assertEquals(roleActionRows(scout, viewer("owner"), []).at(-1), {
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

Deno.test("actions: Archive is refused in place, never hidden — free, it says nothing extra", () => {
	const held = role("r-held", null, "member", ["view_analytics"], "Held", 2);
	const archive = roleActionRows(held, viewer("owner"), []).at(-1)!;
	assertEquals(archive, {
		action: "archive",
		disabledReason: "2 members hold this role — move them all to another role first.",
		hint: "2 members hold it — move them first.",
	});
	const free = roleActionRows(byId("r-designer"), viewer("owner"), []);
	assert(free.every((r) => r.disabledReason === null && r.hint === null));
	// The confirmation says what archiving keeps.
	assertEquals(ARCHIVE_HINT, "Kept on record, never deleted.");
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

Deno.test("clone sources: a clean slate, the kind's templates, then every role, presets first", () => {
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
	assertEquals(points[0].label, "None — clean slate");
	assertEquals(points[1].label, "Contributor template");
	assertEquals(points[1].name, "Contributor");
	const owner = startPointOf(points, "role:r-owner");
	assertEquals(owner.label, "Owner");
	assertEquals(owner.name, "Owner copy");
	assertEquals([...owner.capabilities].sort(), [...capabilitiesForKind("team")].sort());
	assertEquals(startPointOf(points, "nope").key, BLANK_START);
	assertEquals(points.map((p) => p.group), [
		"start",
		"template",
		"preset",
		"preset",
		"preset",
		"preset",
		"custom",
		"custom",
	]);
	// ONE field, in headed runs; a run with nothing in it is left out.
	const groups = cloneOptionGroups(points);
	assertEquals(groups.map((g) => g.label), ["Start", "Templates", "Preset roles", "Custom roles"]);
	assertEquals(groups[3].items.map((i) => i.value), ["role:r-designer", "role:r-treasurer"]);
	assertEquals(groups[0].items[0], {
		value: BLANK_START,
		label: "None — clean slate",
		description: "No permissions; ranks as Member.",
	});
	assertEquals(
		cloneOptionGroups(startPoints("business", [])).map((g) => g.label),
		["Start", "Templates"],
	);
	// The field's hint says what the clone starts with and what it ranks as.
	assertEquals(
		cloneHint({ capabilities: [], basePreset: "member" }),
		"Starts with no permissions and ranks as Member.",
	);
	assertEquals(
		cloneHint({ capabilities: ["view_analytics"], basePreset: "lead" }),
		"Starts with View analytics and ranks as Lead. Change either later.",
	);
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

Deno.test("description: optional, at most the database's 160 characters", () => {
	assertEquals(ROLE_SUMMARY_MAX, 160);
	assertStrictEquals(roleSummaryProblem(""), null);
	assertStrictEquals(roleSummaryProblem("x".repeat(ROLE_SUMMARY_MAX)), null);
	assertEquals(
		roleSummaryProblem("x".repeat(ROLE_SUMMARY_MAX + 1)),
		"Keep the description to 160 characters.",
	);
});

Deno.test("dialog input: create sends the clone's seed; edit keeps the role's capabilities", () => {
	const ws = { kind: "team" as const, id: "ws-1" };
	assertEquals(
		roleEditorInput(ws, {
			mode: "create",
			name: "  Contributor ",
			summary: " Delivers. ",
			basePreset: "member",
			seed: { capabilities: ["view_analytics"] },
		}),
		{
			kind: "team",
			workspaceId: "ws-1",
			name: "Contributor",
			summary: "Delivers.",
			basePreset: "member",
			capabilities: ["view_analytics"],
		},
	);
	assertEquals(
		roleEditorInput(ws, {
			mode: "edit",
			name: "Designers",
			summary: "Draws.",
			basePreset: "member",
			role: byId("r-designer"),
		}),
		{
			kind: "team",
			workspaceId: "ws-1",
			name: "Designers",
			summary: "Draws.",
			basePreset: "member",
			roleId: "r-designer",
			capabilities: ["publish_listings", "view_analytics"],
		},
	);
});

Deno.test("editor copy: the example name fits the kind; the intro and notice follow the start", () => {
	// purchase is a business's alone, so a team is never shown a Purchaser.
	assertEquals(ROLE_NAME_EXAMPLE, { team: "Designer", business: "Purchaser" });
	assert(!capabilitiesForKind("team").includes("purchase"));
	// A clean slate: switch on what it may do once it exists.
	assertEquals(
		roleEditorIntro("create", "team", []),
		"A custom role is a named set of permissions for this team. Switch on what it may do once it " +
			"exists.",
	);
	// The Contributor template already carries View analytics — the intro says so instead.
	const owner = viewer("owner");
	const points = startPoints("team", ROLES);
	const contributor = seedFrom(startPointOf(points, "template:contributor"), owner);
	assertEquals(
		roleEditorIntro("create", "team", contributor.capabilities),
		"A custom role is a named set of permissions for this team. It starts with View " +
			"analytics — change any of it afterwards.",
	);
	// A clone of a large role: a count, not a wall of names.
	const admin = seedFrom(startPointOf(points, "role:r-admin"), owner);
	assert(admin.capabilities.length > 3);
	assert(
		roleEditorIntro("create", "team", admin.capabilities).includes(
			`It starts with ${admin.capabilities.length} permissions`,
		),
	);
	assertEquals(
		roleEditorIntro("edit", "business", ["purchase"]),
		"Its permissions and the people holding it stay as they are.",
	);
	assertEquals(
		roleCreatedNotice("Scout", []),
		"Scout created",
	);
	assertEquals(
		roleCreatedNotice("Contributor", contributor.capabilities),
		"Contributor created with View analytics",
	);
});
// #endregion

// #region Buttons
Deno.test("buttons: each dialog holds one filled control — Create role tier 2, Save changes tier 3", () => {
	for (const saving of [false, true]) {
		const create = roleEditorFooter("create", saving);
		const edit = roleEditorFooter("edit", saving);
		assertEquals(rolesFilledCount(create), 1);
		assertEquals(rolesFilledCount(edit), 1);
		assertEquals(create[0], { key: "cancel", label: "Cancel", tier: 5, disabled: saving });
		assertEquals(create[1].tier, 2);
		assertEquals(edit[1].tier, 3);
		assertEquals(create[1].busy, saving);
	}
	assertEquals(roleEditorFooter("create", false)[1].label, "Create role");
	assertEquals(roleEditorFooter("create", true)[1].label, "Creating…");
	assertEquals(roleEditorFooter("edit", false)[1].label, "Save changes");
});

Deno.test("buttons: tiers draw the matrix's tones; the roster's New role is a slim tier 5 for manage_roles", () => {
	assertEquals(rolesTierProps(2), { structural: true });
	assertEquals(rolesTierProps(3), { variant: "filled" });
	assertEquals(rolesTierProps(4), { severity: "neutral", variant: "outlined" });
	assertEquals(rolesTierProps(5), { variant: "text" });
	assertEquals(newRoleAction(viewer("owner")), { key: "new-role", label: "New role", tier: 5 });
	assertStrictEquals(newRoleAction(viewer("member")), null);
	// Tier 5 is a list affordance, not a fill: the roster adds no filled control to the screen.
	assertEquals(rolesFilledCount([{ tier: 5 }]), 0);
});

Deno.test("footer rig: the save line follows the catalogue's — auto-save offers nothing to press", () => {
	assertEquals(rolesSaveLabel("saving", null, 0, true), { text: "Saving…", actions: [] });
	assertEquals(rolesSaveLabel("dirty", null, 0, true), { text: "Unsaved changes", actions: [] });
	assertEquals(rolesSaveLabel("dirty", null, 0, false), {
		text: "Unsaved changes",
		actions: ["save", "discard"],
	});
	assertEquals(rolesSaveLabel("error", 0, 0, true).actions, ["retry", "discard"]);
	assertEquals(rolesSaveLabel("saved", null, 0, true).text, "All changes saved");
	assertEquals(rolesSaveLabel("saved", 1_000, 13_000, true).text, "Saved · 12s ago");
	assertEquals(savedAgo(2_000), "just now");
	assertEquals(savedAgo(4 * 60_000), "4 min ago");
	assertEquals(savedAgo(2 * 3_600_000), "2 h ago");
	assert(ROLES_AUTOSAVE_MS > 0);
});

Deno.test("footer rig: a custom role's actions, a preset's Clone, nothing without Change roles", () => {
	const owner = viewer("owner");
	assertEquals(rigActions(byId("r-designer"), owner, []).map((a) => [a.key, a.label]), [
		["edit", "Edit role details"],
		["duplicate", "Duplicate role"],
		["archive", "Archive role"],
	]);
	assertEquals(rigActions(byId("r-admin"), owner, []), [
		{ key: "duplicate", label: "Clone as custom role", disabledReason: null },
	]);
	assertEquals(rigActions(byId("r-designer"), { ...owner, canManage: false }, []), []);
	// Archive is refused in place, with the reason as its description — never hidden.
	const held = role("r-held", null, "member", ["view_analytics"], "Held", 2);
	assertEquals(
		rigActions(held, owner, []).at(-1)?.disabledReason,
		"2 members hold this role — move them all to another role first.",
	);
});

Deno.test("copy: the screen's fixed sentences are swept per kind, and a business's never says lead", () => {
	for (const kind of KINDS) {
		const copy = rolesScreenCopy(kind, { kind, payout: null, spend: null, canPropose: false });
		assert(copy.length > 30, `${kind}: ${copy.length}`);
		assert(copy.every((line) => line.trim() !== ""), kind);
	}
	const business = rolesScreenCopy("business", {
		kind: "business",
		payout: null,
		spend: null,
		canPropose: true,
	});
	assertEquals(business.filter((line) => /\blead\b/i.test(line)), []);
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

Deno.test("manager cap: re-ranking a role to admin counts its holders and invitations, before the press", () => {
	// Scouts → admin at 2 of 3: its one holder becomes a manager — 3 of 3, allowed.
	assertStrictEquals(rankCapProblem(bRole("b-scouts"), "admin", capContext(2, 3)), null);
	assertEquals(
		rankCapProblem(bRole("b-scouts"), "admin", capContext(3, 3)),
		"Saving Scouts would add 1 manager. Helia Finance's plan allows 2 managers.",
	);
	// Buyers → admin: one holder becomes a manager (the other already is, by a grant), and its pending
	// invitation starts to count — two seats past 2 of 3.
	assertEquals(
		managerDelta(bRole("b-buyers"), bRole("b-buyers").capabilities, capContext(2, 3), "admin"),
		2,
	);
	assert(rankCapProblem(bRole("b-buyers"), "admin", capContext(2, 3)));
	// The same rank, nothing capping managers, or a team: never.
	assertStrictEquals(rankCapProblem(bRole("b-buyers"), "member", capContext(3, 3)), null);
	assertStrictEquals(rankCapProblem(bRole("b-buyers"), "admin", capContext(2, null)), null);
	assertStrictEquals(
		rankCapProblem(bRole("b-buyers"), "admin", { ...capContext(2, 3), kind: "team" }),
		null,
	);
});

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

Deno.test("manager cap: the switch that would pass the ceiling is locked with the cap's sentence", () => {
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
	// The canvas knows a row is capped, says the cap once, and a read-only viewer sees no cap at all.
	const capCanvas = (cap: RoleCapContext, who = B_OWNER_VIEWER) =>
		roleCanvas({
			role: bRole("b-buyers"),
			roles: B_ROLES,
			draft: {},
			viewer: who,
			policy: { kind: "business", payout: null, spend: null, canPropose: true },
			cap,
		});
	const capped = capCanvas(ctx);
	assert(capped.capped);
	assertEquals(
		capped.domains.flatMap((d) => d.rows).find((r) => r.capability === "manage_projects")?.lock,
		ctx.text,
	);
	assert(!capCanvas(capContext(0, 15)).capped, "headroom to spare");
	const reader = capCanvas(ctx, { ...B_OWNER_VIEWER, canManage: false });
	assertEquals([reader.capped, reader.lock], [false, VIEW_LOCK], "read-only");
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
