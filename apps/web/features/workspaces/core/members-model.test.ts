import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import {
	type BusinessSpendPolicy,
	type BusinessViewerCan,
	capabilitiesForKind,
	presetCapabilities,
	roleRank,
	type SpendLimit,
	type WorkspaceCapability,
	type WorkspaceKind,
	type WorkspaceMember,
	type WorkspaceRole,
	type WorkspaceRoleDef,
} from "@projective/types/workspace";
import { type HandleCheckState, INITIAL_HANDLE_CHECK } from "./handle-check.ts";
import { CAPABILITY_GROUPS, capabilityGroupsFor } from "./capabilities.ts";
import {
	actionInputFor,
	assignableRoles,
	becomesCoOwner,
	capabilityToggleable,
	changeAddsManager,
	confirmAnswered,
	confirmLabel,
	draftFacets,
	draftRankOf,
	drawerFooter,
	drawerTerminal,
	envelopeSection,
	filledCount,
	grantableRoles,
	inviteAddsManager,
	inviteCounts,
	inviteEmailProblem,
	inviteFooter,
	type InviteGateInput,
	inviteGateOpen,
	inviteHandleLine,
	inviteHandleProblem,
	inviteLapsed,
	inviteOverManagerCap,
	inviteRefusalText,
	inviteRoleSeed,
	inviteSeatItems,
	managerCapContextOf,
	managerCapNotice,
	managerCapRefusal,
	managerOptions,
	managersFull,
	managersItem,
	memberAbilities,
	type MemberAction,
	memberActionKeys,
	memberDraftOf,
	memberMenu,
	memberPatch,
	memberSaveRefusal,
	membersHeaderItems,
	membersTierProps,
	NOBODY,
	normalizeInviteHandle,
	overrideItems,
	overridesAtRank,
	overrideSummary,
	permissionGroups,
	reservedAdded,
	reservedGrantWarning,
	roleMetaDefText,
	roleMetaText,
	roleOptions,
	roleText,
	seatsFull,
	sensitiveLabel,
	showsSpending,
	showsStake,
	spendingFact,
	spendingSortValue,
	stakePercent,
	TITLE_EXAMPLE,
	toggleCapability,
	transferCandidates,
	transferConsequences,
	transferFooter,
	transferRefusal,
	workloadText,
} from "./members-model.ts";

/**
 * The Members module's rules (Teams work order C2): the rank rule over (viewerRank, targetRank, caps)
 * — every action the viewer cannot perform ABSENT, as `org.update_workspace_member` refuses it — the
 * invite role list filtered to what the inviter may grant, the handle lookup read for an invitation,
 * the transfer's disclosure and refusals, the drawer's switches and patch, and one filled control per
 * region.
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
): WorkspaceRoleDef {
	return {
		id,
		name,
		summary: `${name} summary`,
		preset,
		basePreset: base,
		capabilities: [...capabilities],
		memberCount: 1,
	};
}

const ROLES: WorkspaceRoleDef[] = [
	role("r-owner", "owner", "owner", OWNER_CAPS),
	role("r-admin", "admin", "admin", ADMIN_CAPS),
	role("r-lead", "lead", "lead", LEAD_CAPS),
	role("r-member", "member", "member", MEMBER_CAPS),
	role("r-designer", null, "lead", ["publish_listings", "view_analytics"], "Designer"),
	role("r-treasurer", null, "admin", ["manage_finances", "withdraw_funds"], "Treasurer"),
];

function member(
	id: string,
	preset: WorkspaceRole,
	extra: Partial<WorkspaceMember> = {},
): WorkspaceMember {
	return {
		id,
		handle: id,
		name: id[0].toUpperCase() + id.slice(1),
		avatar: "",
		email: null,
		roleId: `r-${preset}`,
		rolePreset: preset,
		state: "active",
		overrides: { granted: [], revoked: [] },
		joinedAt: "2026-09-01T00:00:00Z",
		title: null,
		workload: 30,
		wi: 3,
		wiCap: 10,
		availability: "available",
		isSelf: false,
		spendLimitMinor: null,
		contributedMinor: 0,
		shareBp: 2500,
		shareHeld: false,
		reportsTo: null,
		...extra,
	};
}

function check(
	status: HandleCheckState["status"],
	handle: string,
	reason: string | null = null,
): HandleCheckState {
	return { ...INITIAL_HANDLE_CHECK, status, handle, reason };
}
// #endregion

// #region The rank rule
Deno.test("rank rule: available actions per (viewerRank, targetRank, caps)", () => {
	const owner = roleRank("owner");
	const admin = roleRank("admin");
	const lead = roleRank("lead");
	const plain = roleRank("member");
	const cases: {
		name: string;
		viewerRank: number;
		targetRank: number;
		caps: readonly WorkspaceCapability[];
		self?: boolean;
		targetIsOwner?: boolean;
		expect: MemberAction[];
		edit: boolean;
	}[] = [
		{
			name: "owner → admin",
			viewerRank: owner,
			targetRank: admin,
			caps: OWNER_CAPS,
			expect: ["open", "message", "profile", "remove"],
			edit: true,
		},
		{
			name: "admin → lead",
			viewerRank: admin,
			targetRank: lead,
			caps: ADMIN_CAPS,
			expect: ["open", "message", "profile", "remove"],
			edit: true,
		},
		{
			name: "admin → admin (equal rank)",
			viewerRank: admin,
			targetRank: admin,
			caps: ADMIN_CAPS,
			expect: ["open", "message", "profile"],
			edit: false,
		},
		{
			name: "admin → owner",
			viewerRank: admin,
			targetRank: owner,
			caps: ADMIN_CAPS,
			targetIsOwner: true,
			expect: ["open", "message", "profile"],
			edit: false,
		},
		{
			name: "lead → member (no manage_roles)",
			viewerRank: lead,
			targetRank: plain,
			caps: LEAD_CAPS,
			expect: ["open", "message", "profile"],
			edit: false,
		},
		{
			name: "manage_roles without remove_members edits but never removes",
			viewerRank: admin,
			targetRank: plain,
			caps: ["manage_roles"],
			expect: ["open", "message", "profile"],
			edit: true,
		},
		{
			name: "remove_members without manage_roles does nothing",
			viewerRank: admin,
			targetRank: plain,
			caps: ["remove_members"],
			expect: ["open", "message", "profile"],
			edit: false,
		},
		{
			name: "member → member",
			viewerRank: plain,
			targetRank: plain,
			caps: MEMBER_CAPS,
			expect: ["open", "message", "profile"],
			edit: false,
		},
		{
			name: "own row (not owner) → Leave",
			viewerRank: admin,
			targetRank: admin,
			caps: ADMIN_CAPS,
			self: true,
			expect: ["open", "profile", "leave"],
			edit: false,
		},
		{
			name: "owner's own row → Transfer, never Leave or Remove",
			viewerRank: owner,
			targetRank: owner,
			caps: OWNER_CAPS,
			self: true,
			targetIsOwner: true,
			expect: ["open", "profile", "transfer"],
			edit: false,
		},
		{
			name: "no seat → read only",
			viewerRank: 0,
			targetRank: plain,
			caps: [],
			expect: ["open", "message", "profile"],
			edit: false,
		},
	];
	for (const c of cases) {
		const abilities = memberAbilities({
			viewerRank: c.viewerRank,
			targetRank: c.targetRank,
			caps: c.caps,
			self: c.self ?? false,
			targetIsOwner: c.targetIsOwner ?? false,
		});
		assertEquals(memberActionKeys(abilities), c.expect, c.name);
		assertEquals(abilities.edit, c.edit, `${c.name} — edit`);
	}
});

Deno.test("rank rule: the owner row never offers Leave or Remove, to anyone", () => {
	for (const viewerRank of [1, 2, 3, 4]) {
		for (const self of [true, false]) {
			const keys = memberActionKeys(memberAbilities({
				viewerRank,
				targetRank: roleRank("owner"),
				caps: OWNER_CAPS,
				self,
				targetIsOwner: true,
			}));
			assert(!keys.includes("leave") && !keys.includes("remove"), `${viewerRank}/${self}: ${keys}`);
			assertEquals(keys.includes("transfer"), self);
		}
	}
});

Deno.test("rank rule: a custom role ranks as its base preset", () => {
	const viewer = member("ana", "admin", { roleId: "r-treasurer" });
	const target = member("bo", "lead", { roleId: "r-designer" });
	const input = actionInputFor(viewer, target, ["manage_roles", "remove_members"]);
	assertEquals([input.viewerRank, input.targetRank], [roleRank("admin"), roleRank("lead")]);
	assertEquals(memberActionKeys(memberAbilities(input)), ["open", "message", "profile", "remove"]);
	assert(actionInputFor(viewer, { ...viewer }, ADMIN_CAPS).self);
	assertEquals(actionInputFor(null, target, OWNER_CAPS).viewerRank, 0);
});

Deno.test("row menu: only the rows the viewer has, terminal act last", () => {
	const target = member("bo", "member");
	const seen: string[] = [];
	const rows = memberMenu(
		target,
		memberAbilities({
			viewerRank: 4,
			targetRank: 1,
			caps: OWNER_CAPS,
			self: false,
			targetIsOwner: false,
		}),
		(action) => seen.push(action),
	);
	const keys = rows.filter((r) => !r.separator).map((r) => r.key);
	assertEquals(keys, ["link-open-new-tab", "link-copy", "open", "message", "profile", "remove"]);
	assert(rows.every((r) => r.disabled !== true), "no row is ever disabled");
	rows.find((r) => r.key === "remove")?.command?.({ item: {}, originalEvent: new Event("click") });
	assertEquals(seen, ["remove"]);
	const plain = memberMenu(
		target,
		memberAbilities({
			viewerRank: 1,
			targetRank: 1,
			caps: MEMBER_CAPS,
			self: false,
			targetIsOwner: false,
		}),
		() => {},
	);
	assert(!plain.some((r) => r.key === "remove" || r.key === "leave" || r.key === "transfer"));
});
// #endregion

// #region Invite roles
Deno.test("invite: the role list holds only roles the inviter may grant", () => {
	const ids = (caps: readonly WorkspaceCapability[]) =>
		grantableRoles(ROLES, caps).map((r) => r.id);
	assertEquals(ids(OWNER_CAPS), ["r-admin", "r-lead", "r-member", "r-designer", "r-treasurer"]);
	// An admin lacks withdraw_funds, so the Treasurer role (which carries it) is not theirs to offer.
	assertEquals(ids(ADMIN_CAPS), ["r-admin", "r-lead", "r-member", "r-designer"]);
	assertEquals(ids(LEAD_CAPS), ["r-lead", "r-member", "r-designer"]);
	assertEquals(ids(MEMBER_CAPS), ["r-member"]);
	assert(!ids(OWNER_CAPS).includes("r-owner"), "the owner seat moves only by transfer");
});

Deno.test("invite: the dialog opens on the seed if offerable, else Member, else the first", () => {
	const lead = grantableRoles(ROLES, LEAD_CAPS);
	assertEquals(inviteRoleSeed(lead, "r-designer"), "r-designer");
	assertEquals(inviteRoleSeed(lead, "r-admin"), "r-member");
	assertEquals(inviteRoleSeed(lead, null), "r-member");
	const noMember = ROLES.filter((r) => r.id !== "r-member");
	assertEquals(
		inviteRoleSeed(grantableRoles(noMember, ["publish_listings", "view_analytics"]), null),
		"r-designer",
	);
	assertEquals(inviteRoleSeed([], null), "");
});

Deno.test("drawer: the role picker lists the held role and the grantable ones", () => {
	const ids = assignableRoles(ROLES, LEAD_CAPS, "r-treasurer").map((r) => r.id);
	assertEquals(ids, ["r-lead", "r-member", "r-designer", "r-treasurer"]);
});

Deno.test("roles: a custom role reads 'Name · based on Lead'; options carry the summary", () => {
	assertEquals(
		roleText(member("bo", "lead", { roleId: "r-designer" }), ROLES),
		"Designer · based on Lead",
	);
	assertEquals(roleText(member("cy", "admin"), ROLES), "Admin");
	assertEquals(roleText(member("dee", "member", { roleId: "gone" }), ROLES), "Member");
	assertEquals(roleOptions(ROLES.slice(4, 5)), [{
		value: "r-designer",
		label: "Designer · based on Lead",
		description: "Designer summary",
	}]);
});

Deno.test("roles: inside a MetaLine a custom role is ONE item — 'Name (based on Lead)', no middot", () => {
	const designer = roleMetaText(member("bo", "lead", { roleId: "r-designer" }), ROLES);
	assertEquals(designer, "Designer (based on Lead)");
	assert(!designer.includes("·"), "its own middot would read as the MetaLine's separator");
	assertEquals(roleMetaText(member("cy", "admin"), ROLES), "Admin");
	assertEquals(roleMetaText(member("dee", "member", { roleId: "gone" }), ROLES), "Member");
	assertEquals(roleMetaDefText(ROLES[5]), "Treasurer (based on Admin)");
});
// #endregion

// #region Invite handle lookup
const NOBODY_HERE = new Set<string>(["ana"]);

Deno.test("invite: TAKEN is not 'a person' — the server looks it up; AVAILABLE is nobody", () => {
	// The namespace counts teams, businesses, enterprises and 90-day holds as taken too, so a taken
	// handle is never announced as a person found — and no line is a success.
	for (const held of ["ravi", "northloop", "acme-ltd", "renamed-person"]) {
		assertEquals(inviteHandleLine(check("taken", held), NOBODY_HERE), {
			tone: "unchecked",
			text: `We'll look @${held} up when you send.`,
		});
		assertStrictEquals(inviteHandleProblem(check("taken", held), NOBODY_HERE, "team"), null);
	}
	assert(
		[check("taken", "x"), check("checking", "x"), check("available", "x")]
			.every((s) => inviteHandleLine(s, NOBODY_HERE)?.tone !== ("found" as string)),
		"no state reads as a person found",
	);
	assertEquals(
		inviteHandleProblem(check("available", "ghost"), NOBODY_HERE, "team"),
		"Nobody on Projective goes by @ghost.",
	);
	assertEquals(
		inviteHandleProblem(check("taken", "ana"), NOBODY_HERE, "team"),
		"@ana is already in this team.",
	);
	assertEquals(inviteHandleLine(check("checking", "rav"), NOBODY_HERE)?.tone, "checking");
	assertEquals(
		inviteHandleProblem(INITIAL_HANDLE_CHECK, NOBODY_HERE, "team"),
		"Enter their handle.",
	);
	assert(
		inviteHandleProblem(check("reserved", "teams", "That handle is reserved."), NOBODY_HERE, "team")
			?.includes("reserved"),
	);
});

Deno.test("invite: the entity's own handle is refused, with no line and no Send", () => {
	const own = check("taken", "northloop");
	assertEquals(
		inviteHandleProblem(own, NOBODY_HERE, "team", "Northloop"),
		"@northloop is this team's own handle, not a person's.",
	);
	assertStrictEquals(inviteHandleLine(own, NOBODY_HERE, "northloop"), null);
	assertStrictEquals(inviteHandleLine(check("taken", "ana"), NOBODY_HERE, "northloop"), null);
	const gate: InviteGateInput = {
		mode: "handle",
		handle: own,
		email: "",
		roleId: "r-member",
		sending: false,
		seats: null,
		memberHandles: NOBODY_HERE,
		kind: "team",
		ownHandle: "northloop",
	};
	assert(!inviteGateOpen(gate), "the team's own handle never opens Send");
	assert(inviteGateOpen({ ...gate, handle: check("taken", "other-team") }), "the server decides");
});

Deno.test("invite: a handle outside the entity charset is left for the server; a short one is refused", () => {
	const dotted = check("invalid", "ravi.k", "Lowercase letters, numbers and hyphens only.");
	assertStrictEquals(inviteHandleProblem(dotted, NOBODY_HERE, "team"), null);
	assertEquals(inviteHandleLine(dotted, NOBODY_HERE)?.tone, "unchecked");
	const short = check("invalid", "ra", "Handles are at least 3 characters.");
	assertEquals(
		inviteHandleProblem(short, NOBODY_HERE, "team"),
		"Handles are at least 3 characters.",
	);
	const failed: HandleCheckState = { ...check("idle", "ravi"), failed: true };
	assertEquals(inviteHandleLine(failed, NOBODY_HERE)?.tone, "failed");
	assertStrictEquals(inviteHandleProblem(failed, NOBODY_HERE, "team"), null);
	assertEquals(normalizeInviteHandle("  @Ravi K "), "ravik");
});

Deno.test("invite: email shape mirrors the server", () => {
	assertStrictEquals(inviteEmailProblem("name@company.com"), null);
	assertEquals(inviteEmailProblem(""), "Enter their email address.");
	assertEquals(inviteEmailProblem("name@company"), "Enter a valid email address.");
	assertEquals(inviteEmailProblem(`${"a".repeat(160)}@x.io`), "Enter a valid email address.");
});

Deno.test("invite: Send opens only for a role, a free seat and an addressee it has no reason to refuse", () => {
	const base: InviteGateInput = {
		mode: "handle",
		handle: check("taken", "ravi"),
		email: "",
		roleId: "r-member",
		sending: false,
		seats: { used: 3, limit: 15 },
		memberHandles: NOBODY_HERE,
		kind: "team",
	};
	assert(inviteGateOpen(base));
	assert(!inviteGateOpen({ ...base, handle: check("available", "ghost") }));
	assert(!inviteGateOpen({ ...base, handle: check("checking", "ravi") }));
	assert(
		inviteGateOpen({
			...base,
			handle: check("invalid", "ravi.k", "Lowercase letters, numbers and hyphens only."),
		}),
	);
	assert(!inviteGateOpen({ ...base, roleId: "" }));
	assert(!inviteGateOpen({ ...base, seats: { used: 15, limit: 15 } }));
	assert(inviteGateOpen({ ...base, seats: { used: 99, limit: null } }));
	assert(!inviteGateOpen({ ...base, sending: true }));
	assert(inviteGateOpen({ ...base, mode: "email", email: "new@person.io" }));
	assert(!inviteGateOpen({ ...base, mode: "email", email: "nope" }));
});

Deno.test("invite: one filled control — Send (tier 3) beside Cancel (tier 5)", () => {
	const footer = inviteFooter({
		mode: "email",
		handle: INITIAL_HANDLE_CHECK,
		email: "a@b.co",
		roleId: "r-member",
		sending: false,
		seats: null,
		memberHandles: NOBODY_HERE,
		kind: "business",
	});
	assertEquals(footer.map((a) => [a.key, a.tier]), [["cancel", 5], ["send", 3]]);
	assertEquals(filledCount(footer), 1);
	assertEquals(footer[1].label, "Send invitation");
});

Deno.test("invite: seat and pending facts; refusals by typed details", () => {
	assertEquals(
		inviteSeatItems({ used: 5, limit: 15 }, 2).map((i) => typeof i === "string" ? i : i.text),
		[
			"10 of 15 seats free",
			"2 pending invitations",
		],
	);
	assertEquals(
		inviteSeatItems({ used: 4, limit: 4 }, 0).map((i) => typeof i === "string" ? i : i.text),
		[
			"All 4 seats taken or offered",
		],
	);
	assertEquals(inviteSeatItems(null, 1).map((i) => typeof i === "string" ? i : i.text), [
		"1 pending invitation",
	]);
	assert(
		inviteRefusalText({ details: { reason: "seat_cap" } }, "@ravi").startsWith(
			"This team is full.",
		),
	);
	assertEquals(
		inviteRefusalText(
			{ details: { reason: "persona", actor: "other", persona: "client" } },
			"@ravi",
		),
		"@ravi can't join a team — teams are for freelancer accounts.",
	);
	assertEquals(
		inviteRefusalText({ errors: { handle: "they are already a member" } }, "@x"),
		"they are already a member",
	);
});
// #endregion

// #region Header & row facts
Deno.test("header: '5 of 15 seats' and '2 pending invitations', tabular; head-count when uncapped", () => {
	const none = { live: 0, lapsed: 0 };
	assertEquals(
		membersHeaderItems({
			seats: { used: 5, limit: 15 },
			activeCount: 3,
			invites: { live: 2, lapsed: 0 },
			seesQueue: true,
		}),
		[
			{ text: "5 of 15 seats", tabular: true, title: "3 members and 2 open invitations" },
			{ text: "2 pending invitations", tabular: true },
		],
	);
	assertEquals(
		membersHeaderItems({ seats: null, activeCount: 1, invites: none, seesQueue: true }),
		[
			{ text: "1 member", tabular: true },
		],
	);
	assertEquals(
		membersHeaderItems({
			seats: { used: 4, limit: null },
			activeCount: 4,
			invites: none,
			seesQueue: false,
		}),
		[{ text: "4 members", tabular: true }],
	);
	assert(
		seatsFull({ used: 4, limit: 4 }) && !seatsFull({ used: 4, limit: null }) && !seatsFull(null),
	);
});

Deno.test("header: the seat title never tells a viewer who cannot see invitations how many are open", () => {
	// The console read hides the queue from anyone without invite_members, but answers `seats` to all.
	assertEquals(
		membersHeaderItems({
			seats: { used: 5, limit: 15 },
			activeCount: 3,
			invites: { live: 0, lapsed: 0 },
			seesQueue: false,
		}),
		[{ text: "5 of 15 seats", tabular: true, title: undefined }],
	);
});

Deno.test("header: a lapsed invitation holds no seat, so it is never counted as pending", () => {
	const now = Date.parse("2026-10-18T12:00:00Z");
	const invites = [
		{ expiresAt: "2026-10-30T00:00:00Z" },
		{ expiresAt: "2026-10-01T00:00:00Z" },
		{ expiresAt: null },
		{ expiresAt: "2026-10-18T12:00:00Z" },
	];
	assertEquals(inviteCounts(invites, now), { live: 2, lapsed: 2 });
	assert(inviteLapsed({ expiresAt: "2026-10-18T12:00:00Z" }, now), "lapses AT its expiry");
	assert(!inviteLapsed({ expiresAt: "not a date" }, now));
	// seats.used = 3 members + 2 live invitations; the lapsed two are named, never "pending".
	assertEquals(
		membersHeaderItems({
			seats: { used: 5, limit: 15 },
			activeCount: 3,
			invites: inviteCounts(invites, now),
			seesQueue: true,
		}).map((i) => typeof i === "string" ? i : i.text),
		["5 of 15 seats", "2 pending invitations", "2 lapsed"],
	);
	assertEquals(
		membersHeaderItems({
			seats: { used: 3, limit: 15 },
			activeCount: 3,
			invites: { live: 0, lapsed: 1 },
			seesQueue: true,
		}).map((i) => typeof i === "string" ? i : i.text),
		["3 of 15 seats", "1 lapsed invitation"],
	);
});

Deno.test("row facts: overrides as '+2 granted · −1 revoked', sensitive grants counted", () => {
	const m = member("bo", "member", {
		overrides: { granted: ["withdraw_funds", "publish_listings"], revoked: ["view_analytics"] },
	});
	const facets = draftFacets(m, "team", ROLES, m.roleId, m.overrides);
	const summary = overrideSummary(facets);
	assertEquals(overrideItems(summary), [
		{ text: "+2 granted", tabular: true },
		{ text: "−1 revoked", tabular: true },
	]);
	assertEquals(summary.sensitive, ["withdraw_funds"]);
	assertEquals(sensitiveLabel(summary), "1 sensitive grant: Withdraw funds");
	const plain = overrideSummary(
		draftFacets(member("cy", "member"), "team", ROLES, "r-member", { granted: [], revoked: [] }),
	);
	assertEquals(overrideItems(plain), ["Role default"]);
	assertStrictEquals(sensitiveLabel(plain), null);
});

Deno.test("row facts: stake only for manage_finances on a team; W_i as '3 / 10'", () => {
	assert(showsStake("team", ["manage_finances"]));
	assert(!showsStake("team", ADMIN_CAPS.filter((c) => c !== "manage_finances")));
	assert(!showsStake("business", ["manage_finances"]));
	assertEquals([stakePercent(1250), stakePercent(5000), stakePercent(3333), stakePercent(0)], [
		"12.5%",
		"50%",
		"33.33%",
		"0%",
	]);
	assertEquals(workloadText({ wi: 3, wiCap: 10 }), "3 / 10");
	assertEquals(workloadText({ wi: 2.5, wiCap: 10 }), "2.5 / 10");
});
// #endregion

// #region Ownership transfer
Deno.test("transfer: candidates are active members other than the owner", () => {
	const members = [
		member("own", "owner", { isSelf: true }),
		member("ana", "admin"),
		member("gone", "member", { state: "left" }),
	];
	assertEquals(transferCandidates(members, "own").map((m) => m.id), ["ana"]);
});

Deno.test("transfer: the disclosure names the successor; refusals name them too", () => {
	assertEquals(transferConsequences("team", "Ana", false), [
		"You stay on as an Admin.",
		"Withdrawals from the vault move to Ana.",
		"Ana must have a verified identity and payout account.",
	]);
	assert(transferConsequences("team", null, true)[0].startsWith("You leave the team"));
	assert(transferConsequences("business", "Ana", false)[1].includes("Billing"));
	// Before a successor is picked: lower case mid-sentence, capitalised only where a sentence starts.
	assertEquals(transferConsequences("team", null, false), [
		"You stay on as an Admin.",
		"Withdrawals from the vault move to the new owner.",
		"The new owner must have a verified identity and payout account.",
	]);
	assertEquals(
		transferConsequences("business", null, false)[1],
		"Billing, withdrawals and archiving move to the new owner.",
	);
	const payout = transferRefusal(
		{
			message: "x",
			details: { reason: "payout_not_ready", actor: "other", href: null, members: null },
		},
		"Ana",
	);
	assertEquals(payout.code, "payout");
	assert(payout.text.startsWith("Ana can't take ownership yet"));
	assertEquals(
		transferRefusal({ details: { reason: "persona", actor: "other", persona: "client" } }, "Ana")
			.code,
		"persona",
	);
	assertEquals(
		transferRefusal({ message: "successor: choose another active member" }, "Ana").text,
		"successor: choose another active member",
	);
});

Deno.test("transfer: one filled control — the danger confirm — beside Cancel", () => {
	const footer = transferFooter({ working: false, successorId: "", candidates: 2 });
	assertEquals(footer.map((a) => [a.key, a.tier, a.danger ?? false]), [["cancel", 5, false], [
		"transfer",
		3,
		true,
	]]);
	assert(footer[1].disabled, "no successor picked yet, no transfer");
	assertEquals(filledCount(footer), 1);
	// Nobody to hand over to: a confirm that could never become live is absent, not disabled (§3.11).
	assertEquals(
		transferFooter({ working: false, successorId: "", candidates: 0 }).map((a) => [a.key, a.label]),
		[["cancel", "Close"]],
	);
	assertEquals(membersTierProps(3, true), { variant: "filled", severity: "danger" });
	assertEquals(membersTierProps(5), { variant: "text" });
	assertEquals(membersTierProps("link"), { variant: "link" });
});
// #endregion

// #region Member drawer
Deno.test("drawer: switches move the override sets relative to the role", () => {
	const empty = { granted: [], revoked: [] };
	assertEquals(toggleCapability(empty, { capability: "publish_listings", fromRole: false }, true), {
		granted: ["publish_listings"],
		revoked: [],
	});
	assertEquals(toggleCapability(empty, { capability: "view_analytics", fromRole: true }, false), {
		granted: [],
		revoked: ["view_analytics"],
	});
	const revoked = { granted: [], revoked: ["view_analytics" as const] };
	assertEquals(
		toggleCapability(revoked, { capability: "view_analytics", fromRole: true }, true),
		empty,
	);
	const granted = { granted: ["publish_listings" as const], revoked: [] };
	assertEquals(
		toggleCapability(granted, { capability: "publish_listings", fromRole: false }, false),
		empty,
	);
});

Deno.test("drawer: a switch exists only where the viewer may flip it", () => {
	const m = member("bo", "member");
	const facets = draftFacets(m, "team", ROLES, m.roleId, m.overrides);
	const lead = permissionGroups(facets, {
		kind: "team",
		editable: true,
		viewerCaps: LEAD_CAPS,
		viewerIsOwner: false,
	}, "Member");
	const rows = new Map(lead.flatMap((g) => g.rows).map((r) => [r.capability, r]));
	assert(rows.get("view_analytics")?.toggleable, "anything on may be taken away");
	assert(rows.get("publish_listings")?.toggleable, "a lead may grant what they hold");
	assert(!rows.get("withdraw_funds")?.toggleable, "nobody grants what they lack");
	assertEquals(rows.get("withdraw_funds")?.warning, "Moves money out to a bank account.");
	assertStrictEquals(rows.get("view_analytics")?.warning, null);
	const readOnly = permissionGroups(facets, {
		kind: "team",
		editable: false,
		viewerCaps: OWNER_CAPS,
		viewerIsOwner: true,
	}, "Member");
	assert(readOnly.flatMap((g) => g.rows).every((r) => !r.toggleable));
	// The groups are the shared grouping, scoped to the kind.
	assertEquals(lead.map((g) => g.title), capabilityGroupsFor("team").map((g) => g.title));
	assertEquals(
		lead.flatMap((g) => g.rows).length,
		capabilitiesForKind("team").length,
	);
	assert(CAPABILITY_GROUPS.length >= lead.length);
});

Deno.test("drawer: a business's owner-reserved rights switch only at the owner's hand", () => {
	const m = member("bo", "admin");
	const kind: WorkspaceKind = "business";
	const [billing] = draftFacets(m, kind, ROLES, m.roleId, m.overrides).filter((f) =>
		f.capability === "manage_billing"
	);
	const caps = presetCapabilities("owner", kind);
	assert(
		!capabilityToggleable(billing, {
			kind,
			editable: true,
			viewerCaps: caps,
			viewerIsOwner: false,
		}),
	);
	assert(
		capabilityToggleable(billing, { kind, editable: true, viewerCaps: caps, viewerIsOwner: true }),
	);
});

Deno.test("drawer: a save sends only what changed", () => {
	const m = member("bo", "member", { title: "Designer", reportsTo: "ana" });
	const start = memberDraftOf(m);
	assertStrictEquals(memberPatch(m, start), null);
	assertEquals(memberPatch(m, { ...start, roleId: "r-lead" }), { roleId: "r-lead" });
	assertEquals(memberPatch(m, { ...start, title: "  " }), { title: null });
	assertEquals(memberPatch(m, { ...start, reportsTo: "" }), { reportsTo: null });
	assertEquals(
		memberPatch(m, {
			...start,
			overrides: toggleCapability(
				start.overrides,
				{ capability: "view_analytics", fromRole: true },
				false,
			),
		}),
		{ granted: [], revoked: ["view_analytics"] },
	);
	const options = managerOptions([
		m,
		member("ana", "admin"),
		member("gone", "lead", { state: "left" }),
	], m);
	assertEquals(options.map((o) => o.value), [NOBODY, "ana"]);
});

Deno.test("drawer: Save (tier 3) only where the viewer may edit; Close is tier 5", () => {
	const editing = drawerFooter({ editable: true, dirty: false, saving: false });
	assertEquals(editing.map((a) => [a.key, a.tier]), [["close", 5], ["save", 3]]);
	assert(editing[1].disabled, "nothing to save yet");
	assertEquals(filledCount(editing), 1);
	const reading = drawerFooter({ editable: false, dirty: false, saving: false });
	assertEquals(reading.map((a) => a.key), ["close"]);
	assertEquals(filledCount(reading), 0);
});

Deno.test("drawer: the owner row's terminal act is the Transfer link — never Leave or Remove", () => {
	const owner = memberAbilities({
		viewerRank: 4,
		targetRank: 4,
		caps: OWNER_CAPS,
		self: true,
		targetIsOwner: true,
	});
	assertEquals(drawerTerminal(owner, { name: "Kwame" }, "team")?.key, "transfer");
	assertEquals(drawerTerminal(owner, { name: "Kwame" }, "team")?.tier, "link");
	const ownerSeenByAdmin = memberAbilities({
		viewerRank: 3,
		targetRank: 4,
		caps: ADMIN_CAPS,
		self: false,
		targetIsOwner: true,
	});
	assertStrictEquals(drawerTerminal(ownerSeenByAdmin, { name: "Kwame" }, "team"), null);
	const self = memberAbilities({
		viewerRank: 2,
		targetRank: 2,
		caps: LEAD_CAPS,
		self: true,
		targetIsOwner: false,
	});
	assertEquals(drawerTerminal(self, { name: "Sam" }, "team")?.label, "Leave team");
	const other = memberAbilities({
		viewerRank: 4,
		targetRank: 1,
		caps: OWNER_CAPS,
		self: false,
		targetIsOwner: false,
	});
	const remove = drawerTerminal(other, { name: "Bo" }, "business");
	assertEquals([remove?.key, remove?.tier, remove?.danger], ["remove", 5, true]);
});
// #endregion

// #region Business specifics (BU7)
const B_OWNER = presetCapabilities("owner", "business");
const B_ADMIN = presetCapabilities("admin", "business");
const B_MEMBER = presetCapabilities("member", "business");

/**
 * A business's presets and three custom roles: an admin-ranked Deputy, an Observer, and a
 * member-ranked projects role (the Project Manager template's shape, #249 (a)).
 */
const B_ROLES: WorkspaceRoleDef[] = [
	role("r-owner", "owner", "owner", B_OWNER),
	role("r-admin", "admin", "admin", B_ADMIN),
	role("r-member", "member", "member", B_MEMBER),
	role("r-deputy", null, "admin", B_ADMIN.filter((c) => c !== "manage_finances"), "Deputy"),
	role("r-observer", null, "member", ["view_analytics"], "Observer"),
	role("r-projects", null, "member", ["manage_projects", "view_analytics"], "Projects"),
];

const usd = (minor: number) => ({
	minor,
	currency: "USD",
	display: `US$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
	origin: null,
});

function envelope(memberId: string, handle: string, extra: Partial<SpendLimit> = {}): SpendLimit {
	return {
		memberId,
		handle,
		name: handle,
		avatar: "",
		canSpend: true,
		limitMinor: null,
		limit: null,
		period: "monthly",
		spentMinor: 0,
		spent: usd(0),
		remainingMinor: null,
		remaining: null,
		usedFraction: 0,
		perTransactionMinor: null,
		perTransaction: null,
		...extra,
	};
}

const HANNAH_ENVELOPE = envelope("m-hannah", "hannahcole", {
	limitMinor: 2_500_000,
	limit: usd(2_500_000),
	perTransactionMinor: 1_000_000,
	perTransaction: usd(1_000_000),
});

function spendPolicy(extra: Partial<BusinessSpendPolicy> = {}): BusinessSpendPolicy {
	return {
		currency: "USD",
		approvalThresholdMinor: null,
		approvalThreshold: null,
		platformThresholdMinor: null,
		platformThreshold: null,
		editableMemberIds: ["m-hannah"],
		approverGap: false,
		limitsPlanGated: true,
		approverIds: ["m-priya", "m-hannah"],
		approverHandles: [],
		limits: [envelope("m-priya", "priyaraman"), HANNAH_ENVELOPE],
		readsAllEnvelopes: true,
		contributorIds: [],
		contributorHandles: [],
		entries: [],
		approvals: { pending: [], decided: [] },
		verification: "verified",
		verificationPrompt: null,
		...extra,
	};
}

const CAN_NOTHING: BusinessViewerCan = {
	editPolicy: false,
	decide: false,
	requestSpend: false,
	payInvoice: false,
	startKyb: false,
	hire: false,
	purchase: false,
	manageProjects: false,
	archive: false,
};

type EnvelopeWorkspace = Parameters<typeof envelopeSection>[0];

/** The Helia console as each viewer reads it. */
function helia(viewer: "owner" | "admin" | "approver" | "spender" | "member"): EnvelopeWorkspace {
	const caps = {
		owner: B_OWNER,
		admin: B_ADMIN,
		approver: [...B_MEMBER, "approve_spend"] as WorkspaceCapability[],
		spender: [...B_MEMBER, "spend_funds"] as WorkspaceCapability[],
		member: B_MEMBER,
	}[viewer];
	const spend = {
		owner: spendPolicy(),
		admin: spendPolicy({ editableMemberIds: [] }),
		approver: spendPolicy({ editableMemberIds: [] }),
		spender: spendPolicy({
			editableMemberIds: [],
			readsAllEnvelopes: false,
			limits: [envelope("m-ren", "renkoda")],
		}),
		member: null,
	}[viewer];
	return {
		kind: "business",
		handle: "heliafinance",
		spend,
		viewerCan: { ...CAN_NOTHING, editPolicy: viewer === "owner" || viewer === "admin" },
		viewerCapabilities: caps,
	};
}

const PRIYA = { id: "m-priya", handle: "priyaraman", isSelf: false, rolePreset: "owner" as const };
const HANNAH = {
	id: "m-hannah",
	handle: "hannahcole",
	isSelf: false,
	rolePreset: "admin" as const,
};

Deno.test("business: the Spending column is the server's call — every envelope, or none", () => {
	assert(showsSpending(helia("owner")));
	assert(showsSpending(helia("approver")), "an approver reads every envelope (#238 (E))");
	assert(!showsSpending(helia("spender")), "a spender's limits hold only their own row");
	assert(!showsSpending(helia("member")), "no spend block, no column");
	assert(!showsSpending({ kind: "team", spend: spendPolicy() }), "a team has no envelopes");
	assertEquals(spendingFact(helia("owner"), "m-hannah"), {
		text: "US$25,000.00 / month",
		tabular: true,
	});
	assertEquals(spendingFact(helia("owner"), "m-priya"), "No ceiling");
	assertStrictEquals(spendingFact(helia("spender"), "m-ren"), null, "never inferred from a row");
	const off = envelope("m-x", "x", { canSpend: false });
	assertEquals(
		[off, HANNAH_ENVELOPE, envelope("m-y", "y"), null].map(spendingSortValue),
		[-1, 2_500_000, Number.MAX_SAFE_INTEGER, -1],
	);
});

Deno.test("business drawer: the envelope for the policy's editors (Edit or Open in Spend), read-only for readers", () => {
	const edit = envelopeSection(helia("owner"), HANNAH);
	assertEquals(edit?.link, {
		label: "Edit in Spend",
		href: "/businesses/heliafinance/spend#limit-hannahcole",
	});
	assertEquals(edit?.facts, [
		{ text: "US$25,000.00 / month", tabular: true },
		{ text: "US$10,000.00 per purchase", tabular: true },
	]);
	// The owner's own row is never theirs to edit (save_spend_policy) — it opens Spend there.
	assertEquals(envelopeSection(helia("owner"), PRIYA)?.link?.label, "Open in Spend");
	assertEquals(envelopeSection(helia("owner"), PRIYA)?.facts, ["No ceiling"]);
	// An admin without the row in editableMemberIds reads Open in Spend.
	assertEquals(envelopeSection(helia("admin"), PRIYA)?.link?.label, "Open in Spend");
	// Nobody sets the owner's envelope (save_spend_policy skips the owner), so it never says who does.
	const ownerRow = "The owner's limit isn't set on the spend policy — nobody changes it there.";
	assertEquals(envelopeSection(helia("admin"), PRIYA)?.note, ownerRow);
	assertEquals(envelopeSection(helia("approver"), PRIYA)?.note, ownerRow);
	assertEquals(
		envelopeSection(helia("owner"), { ...PRIYA, isSelf: true })?.note,
		"As the owner, your limit isn't set on the spend policy — nobody changes it there.",
	);
	// An approver reads every envelope but edits none: the facts, linked to the row.
	const read = envelopeSection(helia("approver"), HANNAH);
	assertEquals(read?.link?.label, "Open in Spend");
	assertEquals(read?.note, "Set on the spend policy by the people who run it.");
	// A spender sees their own envelope in their own drawer, and nobody else's (FLAG #249 (q)).
	const own = envelopeSection(helia("spender"), {
		id: "m-ren",
		handle: "renkoda",
		isSelf: true,
		rolePreset: "member",
	});
	assertEquals(own?.note, "Your limit, as the spend policy sets it.");
	assertEquals(own?.facts, ["No ceiling"]);
	assertStrictEquals(envelopeSection(helia("spender"), HANNAH), null);
	// Nothing for a viewer with no spend block, and nothing on a team.
	assertStrictEquals(envelopeSection(helia("member"), HANNAH), null);
	assertStrictEquals(envelopeSection({ ...helia("owner"), kind: "team" }, HANNAH), null);
});

Deno.test("business: the manager headroom heads Members — tabular, and absent while nothing caps it", () => {
	const none = { live: 1, lapsed: 0 };
	const items = membersHeaderItems({
		seats: null,
		activeCount: 2,
		invites: none,
		seesQueue: true,
		managers: { used: 1, limit: 2 },
	});
	assertEquals(items.map((i) => typeof i === "string" ? i : i.text), [
		"2 members",
		"1 of 2 managers",
		"1 pending invitation",
	]);
	assertEquals(managersItem({ used: 2, limit: 2 })?.tabular, true);
	assertEquals(managersItem({ used: 0, limit: 1 })?.text, "0 of 1 manager");
	assertStrictEquals(managersItem({ used: 3, limit: null }), null, "gates off or unlimited");
	assertStrictEquals(managersItem(null), null, "a team");
	assertEquals(
		membersHeaderItems({ seats: null, activeCount: 2, invites: none, seesQueue: true }).length,
		2,
		"a team's head is unchanged",
	);
	assert(managersFull({ used: 2, limit: 2 }));
	assert(managersFull({ used: 3, limit: 2 }), "past a downgraded ceiling");
	assert(!managersFull({ used: 1, limit: 2 }));
	assert(!managersFull({ used: 9, limit: null }));
	assert(!managersFull(null));
});

Deno.test("business: which roles take a manager seat mirrors org.fn_business_role_is_manager", () => {
	const byId = (id: string) => B_ROLES.find((r) => r.id === id)!;
	assert(inviteAddsManager("business", byId("r-admin")));
	assert(inviteAddsManager("business", byId("r-deputy")), "admin-ranked");
	assert(inviteAddsManager("business", byId("r-projects")), "manages projects");
	assert(!inviteAddsManager("business", byId("r-observer")));
	assert(!inviteAddsManager("business", byId("r-member")));
	assert(!inviteAddsManager("business", byId("r-owner")), "the owner is never counted");
	assert(!inviteAddsManager("team", byId("r-admin")), "a team has no manager cap");
	assert(!inviteAddsManager("business", null));
});

Deno.test("business invite: a manager's role at the cap closes Send and says why; Member reopens it", () => {
	const gate: InviteGateInput = {
		mode: "handle",
		handle: check("taken", "juno"),
		email: "",
		roleId: "r-projects",
		sending: false,
		seats: null,
		memberHandles: NOBODY_HERE,
		kind: "business",
		managers: { used: 2, limit: 2 },
		roles: B_ROLES,
	};
	assert(inviteOverManagerCap(gate));
	assert(!inviteGateOpen(gate));
	assert(inviteFooter(gate)[1].disabled);
	assert(inviteGateOpen({ ...gate, roleId: "r-member" }), "a plain member takes no manager seat");
	assert(inviteGateOpen({ ...gate, roleId: "r-observer" }));
	assert(inviteGateOpen({ ...gate, managers: { used: 1, limit: 2 } }), "a seat is left");
	assert(inviteGateOpen({ ...gate, managers: { used: 5, limit: null } }), "nothing caps it");
	assert(inviteGateOpen({ ...gate, managers: undefined, roles: undefined }), "no headroom read");
});

Deno.test("business: the manager cap is the refusal map's entitlement sentence; plans are withheld", () => {
	const owner = managerCapNotice({ business: "Helia Finance", limit: 2, viewerIsOwner: true });
	assertEquals(
		owner.sentence,
		"Helia Finance's plan allows 2 managers — admins and roles that manage projects — and they're all taken or offered. More are part of Business Pro.",
	);
	assertEquals(owner.meta, "Changing plans isn't available yet.");
	const admin = managerCapNotice({ business: "Helia Finance", limit: 2, viewerIsOwner: false });
	assertEquals(admin.meta, "Ask the owner about upgrading to Business Pro.");
	assertEquals(
		managerCapContextOf({
			name: "Helia Finance",
			managers: { used: 2, limit: 2 },
			members: [member("m-priya", "owner"), member("m-hannah", "admin")],
			viewerMemberId: "m-priya",
		}),
		{ business: "Helia Finance", limit: 2, viewerIsOwner: true },
	);
	const capped = {
		ok: false,
		message: "This business's plan allows 2 managers…",
		details: { reason: "entitlement", entitlement: "business_managers" },
	};
	const ctx = { business: "Helia Finance", limit: 2, viewerIsOwner: false };
	assertEquals(inviteRefusalText(capped, "@juno", ctx), `${admin.sentence} ${admin.meta}`);
	assertEquals(managerCapRefusal(capped.details, ctx), `${admin.sentence} ${admin.meta}`);
	assertEquals(memberSaveRefusal(capped, ctx), `${admin.sentence} ${admin.meta}`);
	// Another plan gate, or any other refusal, keeps its own words.
	const other = { details: { reason: "entitlement", entitlement: "pooled_wallet_full" } };
	assertStrictEquals(managerCapRefusal(other.details, ctx), null);
	assertEquals(memberSaveRefusal({ errors: { title: "Too long." } }, ctx), "Too long.");
	assertEquals(memberSaveRefusal({}, ctx), "Could not save those changes.");
});

Deno.test("business drawer: a change that makes somebody a manager is the one the cap checks", () => {
	const plain = member("m-ren", "member", { roleId: "r-member" });
	const saved = draftFacets(plain, "business", B_ROLES, "r-member", plain.overrides);
	const to = (roleId: string, granted: WorkspaceCapability[] = []) => ({
		kind: "business" as const,
		member: plain,
		saved,
		draftRank: draftRankOf(plain, B_ROLES, roleId),
		draft: draftFacets(plain, "business", B_ROLES, roleId, { granted, revoked: [] }),
	});
	assert(changeAddsManager(to("r-admin")), "to Admin");
	assert(changeAddsManager(to("r-deputy")), "to an admin-ranked custom role");
	assert(changeAddsManager(to("r-projects")), "to the Project Manager template's shape");
	assert(changeAddsManager(to("r-member", ["manage_projects"])), "a manage_projects grant");
	assert(!changeAddsManager(to("r-observer")), "the Observer is no manager");
	assert(!changeAddsManager(to("r-member")), "nothing changed");
	assertEquals(draftRankOf(plain, B_ROLES, "r-deputy"), "admin");
	assertEquals(draftRankOf(plain, B_ROLES, "r-projects"), "member");
	assertEquals(draftRankOf(plain, B_ROLES, "gone"), "member");
	// A manager who stays one is never refused (a title change past a downgraded ceiling).
	const lead = member("m-hannah", "admin", { roleId: "r-admin" });
	const leadSaved = draftFacets(lead, "business", B_ROLES, "r-admin", lead.overrides);
	assert(
		!changeAddsManager({
			kind: "business",
			member: lead,
			saved: leadSaved,
			draftRank: "admin",
			draft: leadSaved,
		}),
	);
	assert(!changeAddsManager({ ...to("r-admin"), kind: "team" }), "a team has no manager cap");
});

Deno.test("business drawer: a reserved grant owes the typed CONFIRM; taking one away owes nothing", () => {
	const admin = member("m-hannah", "admin", { roleId: "r-admin" });
	const saved = draftFacets(admin, "business", B_ROLES, "r-admin", admin.overrides);
	const billing = draftFacets(admin, "business", B_ROLES, "r-admin", {
		granted: ["manage_billing"],
		revoked: [],
	});
	assertEquals(reservedAdded("business", saved, billing), ["manage_billing"]);
	assertEquals(reservedAdded("business", billing, saved), [], "a revocation needs no word");
	assertEquals(reservedAdded("team", saved, billing), [], "a team reserves nothing");
	assertEquals(
		reservedGrantWarning("Hannah Cole", ["manage_billing"], false),
		"Hannah Cole can then pay the plan and the invoices and run the business's verification. Only you can take it away, and they can't pass it on.",
	);
	assertStrictEquals(reservedGrantWarning("Hannah Cole", [], false), null);
	const all = draftFacets(admin, "business", B_ROLES, "r-admin", {
		granted: ["withdraw_funds", "manage_billing", "archive_entity"],
		revoked: [],
	});
	assert(becomesCoOwner("business", "admin", all));
	assert(!becomesCoOwner("business", "admin", billing));
	assert(
		reservedGrantWarning("Hannah Cole", reservedAdded("business", saved, all), true)?.startsWith(
			"Hannah Cole becomes a co-owner",
		),
	);
	assertEquals(confirmLabel(["manage_billing"]), "Type CONFIRM to grant it");
	assertEquals(confirmLabel(["withdraw_funds", "archive_entity"]), "Type CONFIRM to grant them");
	assert(confirmAnswered("CONFIRM") && confirmAnswered("  CONFIRM "));
	assert(!confirmAnswered("confirm") && !confirmAnswered(""), "the server takes the word exactly");
	// Save stays closed while the word is owed (or the cap would refuse).
	assert(drawerFooter({ editable: true, dirty: true, saving: false, blocked: true })[1].disabled);
	assert(!drawerFooter({ editable: true, dirty: true, saving: false, blocked: false })[1].disabled);
	// The patch carries the word only when the screen adds it.
	assertEquals(memberPatch(admin, { ...memberDraftOf(admin), title: "x" }), { title: "x" });
});

Deno.test("business drawer: the billing right goes only to an admin seat — offered, and kept, only there", () => {
	const plain = member("m-ren", "member", { roleId: "r-member" });
	const facets = draftFacets(plain, "business", B_ROLES, "r-member", plain.overrides);
	const billing = facets.find((f) => f.capability === "manage_billing")!;
	const ctx = {
		kind: "business" as const,
		editable: true,
		viewerCaps: B_OWNER,
		viewerIsOwner: true,
	};
	assert(!capabilityToggleable(billing, { ...ctx, draftRank: "member" }), "a member's seat");
	assert(capabilityToggleable(billing, { ...ctx, draftRank: "admin" }), "an admin's seat");
	assert(capabilityToggleable(billing, ctx), "no draft rank given — the old rule");
	// Moving a billing admin off the admin seat drops the grant from the draft.
	const held = { granted: ["manage_billing", "hire"] as WorkspaceCapability[], revoked: [] };
	assertEquals(overridesAtRank("business", held, "member"), { granted: ["hire"], revoked: [] });
	assertStrictEquals(overridesAtRank("business", held, "admin"), held);
	assertStrictEquals(overridesAtRank("team", held, "member"), held);
});

Deno.test("business: the Title example is never lead; a team's stays", () => {
	assertEquals(TITLE_EXAMPLE.team, "Design lead");
	assertEquals(TITLE_EXAMPLE.business, "Head of marketing");
});
// #endregion
