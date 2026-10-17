/**
 * The pure rules of the live workspace console (`mappers.ts`): roster stats, the create allowance, the
 * setup checklist, split derivation, the even-split template, spend-request states, and the smaller
 * parsers — each pinned against the behaviour the console depends on, with an injected clock.
 */
import { assertEquals, assertStrictEquals } from "@std/assert";
import { presetCapabilities, type WorkspaceCapability } from "@projective/types/workspace";
import {
	activityText,
	availabilityOf,
	createBlockedReason,
	deriveSplitModel,
	evenSplit,
	largestAmount,
	parseCapabilities,
	parseStatus,
	parseVerification,
	progressOf,
	projectedShare,
	projectState,
	projectStatusLabel,
	type RawActivity,
	relativeLabel,
	rosterStats,
	setupCompletion,
	type SetupFacts,
	setupSteps,
	spendRequestState,
	spentInPeriod,
	toEngagement,
	toOutgoingInvite,
	toRoleDef,
	toSplitRule,
	usedFraction,
	verificationPrompt,
	visibleActivity,
	wiCapOf,
	wiOf,
	workloadPercent,
} from "./mappers.ts";

const NOW = Date.parse("2026-09-28T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

// #region Roster

Deno.test("rosterStats: team earns, business spends, members and projects are plain counts, no delta", () => {
	const team = rosterStats("team", {
		member_count: 3,
		active_projects: 1,
		money_30d: [{ currency: "USD", minor: 2_850_000 }],
	});
	assertEquals(team.map((s) => s.label), ["Members", "Active projects", "Earned (30d)"]);
	assertEquals(team.map((s) => s.value), ["3", "1", "US$28,500.00"]);
	assertEquals(team.every((s) => s.delta === null), true);
	const biz = rosterStats("business", { member_count: 2, active_projects: 0, money_30d: [] });
	assertEquals(biz[2], { label: "Spent (30d)", value: "—", delta: null });
	// Every currency that moved counts: the largest figure, then how many others there are.
	const multi = rosterStats("business", {
		member_count: 2,
		active_projects: 0,
		money_30d: [
			{ currency: "EUR", minor: 12_000 },
			{ currency: "usd", minor: 2_850_000 },
			{ currency: "GBP", minor: 0 },
			{ currency: "JPY", minor: 900 },
		],
	});
	assertEquals(multi[2].value, "US$28,500.00 +2");
});

Deno.test("largestAmount compares in major units and never sums currencies", () => {
	// ¥500,000 (exponent 0) is 500,000 major; $6,000.00 is 6,000 major — the yen wins, unconverted.
	assertEquals(
		largestAmount([{ currency: "usd", minor: 600_000 }, { currency: "JPY", minor: 500_000 }]),
		{
			currency: "JPY",
			minor: 500_000,
		},
	);
	assertEquals(largestAmount([{ currency: "GBP", minor: 0 }]), null);
	assertEquals(largestAmount(null), null);
});

Deno.test("createBlockedReason: unlimited or under the cap → null; at the cap → the plan's own number, kind-worded", () => {
	assertStrictEquals(createBlockedReason("team", null, 9), null);
	assertStrictEquals(createBlockedReason("team", 3, 2), null);
	assertEquals(
		createBlockedReason("team", 3, 3),
		"Your plan includes 3 teams — archive one or upgrade to create another.",
	);
	assertEquals(
		createBlockedReason("business", 1, 1),
		"Your plan includes 1 business — archive one or upgrade to create another.",
	);
});

// #endregion

// #region Setup checklist

/** Facts for a brand-new entity, overridden per case. */
const facts = (over: Partial<SetupFacts> = {}): SetupFacts => ({
	logo: false,
	bio: false,
	activeMembers: 1,
	invitePending: false,
	money: false,
	verified: false,
	published: false,
	...over,
});

Deno.test("setupSteps: a team walks invite · split · profile · owner · publish, by handle", () => {
	const steps = setupSteps("team", "northloop", facts({ logo: true, money: true }));
	assertEquals(steps.map((s) => s.id), ["invite", "money", "profile", "verification", "publish"]);
	assertEquals(steps.map((s) => s.href), [
		"/teams/northloop/invitations",
		"/teams/northloop/payouts",
		"/@northloop/edit",
		"/teams/northloop/verification",
		"/teams/northloop/settings",
	]);
	// The profile needs BOTH the mark and the one-liner.
	assertEquals(steps.map((s) => s.done), [false, true, false, false, false]);
	assertEquals(setupCompletion(steps), 0.2);
	assertEquals(
		setupSteps("team", "northloop", facts({ logo: true, bio: true })).map((s) => s.done),
		[false, false, true, false, false],
	);
	const ready = setupSteps("team", "northloop", {
		...facts({ logo: true, bio: true, money: true, verified: true, published: true }),
		activeMembers: 2,
	});
	assertEquals(setupCompletion(ready), 1);
});

Deno.test("setupSteps: a team's invite step needs two ACTIVE members — an invitation out is not enough", () => {
	const pending = setupSteps("team", "northloop", facts({ invitePending: true }))[0];
	assertEquals(pending.done, false);
	assertEquals(pending.note.startsWith("An invitation is out"), true);
	assertEquals(setupSteps("team", "northloop", facts())[0].note.startsWith("A team needs"), true);
	assertEquals(setupSteps("team", "northloop", facts({ activeMembers: 2 }))[0].done, true);
	// Published means it has left draft — an archived team was published once.
	assertEquals(setupSteps("team", "northloop", facts({ published: true }))[4].done, true);
});

Deno.test("setupSteps: a business keeps mark · one-liner · invite · threshold · KYB", () => {
	const biz = setupSteps("business", "helia", {
		...facts({ logo: true, bio: true, money: true, verified: true }),
		invitePending: true,
	});
	assertEquals(biz.map((s) => s.id), ["logo", "bio", "invite", "money", "verification"]);
	assertEquals(biz[3].href, "/businesses/helia/spend");
	assertEquals(biz[4].label, "Finish KYB");
	// A business's invite step is finished by an invitation sent, or a second member.
	assertEquals(biz[2].done, true);
	assertEquals(setupSteps("business", "helia", facts({ activeMembers: 2 }))[2].done, true);
	assertEquals(setupSteps("business", "helia", facts())[2].done, false);
	assertEquals(setupCompletion(biz), 1);
	assertEquals(setupCompletion([]), 1);
});

Deno.test("setupSteps: each step is actionable only for a viewer holding its right", () => {
	const actionable = (kind: "team" | "business", viewer?: WorkspaceCapability[]) =>
		setupSteps(kind, "northloop", facts({ viewer })).map((s) => `${s.id}:${s.actionable}`);
	// No viewer (the roster) — nothing is offered.
	assertEquals(actionable("team"), [
		"invite:false",
		"money:false",
		"profile:false",
		"verification:false",
		"publish:false",
	]);
	// A plain member (`view_analytics` only) can act on none of them.
	assertEquals(actionable("team", ["view_analytics"]).every((s) => s.endsWith(":false")), true);
	// The owner's preset can act on all five.
	assertEquals(
		actionable("team", [...presetCapabilities("owner", "team")]).every((s) => s.endsWith(":true")),
		true,
	);
	// One right each.
	assertEquals(actionable("team", ["invite_members"])[0], "invite:true");
	assertEquals(actionable("team", ["manage_finances"])[1], "money:true");
	assertEquals(actionable("team", ["edit_profile"])[2], "profile:true");
	assertEquals(actionable("team", ["manage_settings"]).slice(3), [
		"verification:true",
		"publish:true",
	]);
	// A business's KYB follows the billing right, not settings (Decision #230 (d)).
	assertEquals(actionable("business", ["manage_settings"])[4], "verification:false");
	assertEquals(actionable("business", ["manage_billing"])[4], "verification:true");
});

Deno.test("verificationPrompt: null once verified, worded by kind and state otherwise", () => {
	assertStrictEquals(verificationPrompt("team", "verified"), null);
	assertStrictEquals(verificationPrompt("business", "verified"), null);
	assertEquals(verificationPrompt("team", "unverified")?.includes("owner's identity"), true);
	assertEquals(verificationPrompt("team", "pending")?.includes("under review"), true);
	assertEquals(verificationPrompt("business", "unverified")?.includes("KYB"), true);
});

// #endregion

// #region Members & roles

Deno.test("workloadPercent rounds and clamps; no capacity is 0", () => {
	assertEquals(workloadPercent(2, 5), 40);
	assertEquals(workloadPercent(1, 3), 33);
	assertEquals(workloadPercent(9, 5), 100);
	assertEquals(workloadPercent(null, 5), 0);
	assertEquals(workloadPercent(3, 0), 0);
	assertEquals(workloadPercent(3, null), 0);
});

Deno.test("availabilityOf: busy is limited, away is unavailable, anything unknown is the column default", () => {
	assertEquals(availabilityOf("available"), "available");
	assertEquals(availabilityOf("busy"), "limited");
	assertEquals(availabilityOf("limited"), "limited");
	assertEquals(availabilityOf("unavailable"), "unavailable");
	assertEquals(availabilityOf("away"), "unavailable");
	assertEquals(availabilityOf(null), "available");
	assertEquals(availabilityOf("on-a-boat"), "available");
});

Deno.test("parsers keep only what the SSOT knows", () => {
	assertEquals(parseCapabilities(["view_audit", "nonsense", "invite_members", "view_audit"]), [
		"invite_members",
		"view_audit",
	]);
	assertEquals(parseStatus("active"), "active");
	assertEquals(parseStatus("deleted"), "draft");
	assertEquals(parseVerification("verified"), "verified");
	assertEquals(parseVerification("rejected"), "unverified");
});

Deno.test("toRoleDef: a custom role ranks as its base, a preset as itself; capabilities filtered", () => {
	const custom = toRoleDef({
		id: "r1",
		name: "Reviewer",
		summary: null,
		preset: null,
		base_preset: "member",
		capabilities: ["view_audit", "bogus"],
		member_count: 2,
	});
	assertEquals(custom, {
		id: "r1",
		name: "Reviewer",
		summary: "",
		preset: null,
		basePreset: "member",
		capabilities: ["view_audit"],
		memberCount: 2,
	});
	const preset = toRoleDef({
		id: "r2",
		name: "Admin",
		summary: "Runs the roster",
		preset: "admin",
		base_preset: "admin",
		capabilities: ["invite_members"],
		member_count: 0,
	});
	assertEquals([preset.preset, preset.basePreset], ["admin", "admin"]);
	// An unknown base collapses to the lowest rank rather than inventing authority.
	assertEquals(
		toRoleDef({
			id: "r3",
			name: "X",
			summary: null,
			preset: null,
			base_preset: "czar",
			capabilities: null,
			member_count: 0,
		})
			.basePreset,
		"member",
	);
});

Deno.test("toOutgoingInvite: an email-only invite has no handle and is named by its address", () => {
	const inv = toOutgoingInvite(
		{
			id: "i1",
			target_user_id: null,
			target_handle: null,
			target_email: "ada@example.com",
			role_id: "r1",
			note: null,
			created_at: daysAgo(2),
			expires_at: daysAgo(-12),
		},
		undefined,
		NOW,
	);
	assertEquals([inv.handle, inv.name, inv.email, inv.sentAt, inv.avatar], [
		"",
		"ada@example.com",
		"ada@example.com",
		"2 days ago",
		"",
	]);
	const person = toOutgoingInvite(
		{
			id: "i2",
			target_user_id: "u",
			target_handle: "noor",
			target_email: null,
			role_id: "r",
			note: "hi",
			created_at: daysAgo(0),
			expires_at: null,
		},
		{ username: "noor", name: "Noor Haddad", avatar: null },
		NOW,
	);
	assertEquals([person.handle, person.name, person.sentAt, person.expiresAt], [
		"noor",
		"Noor Haddad",
		"Today",
		null,
	]);
});

// #endregion

// #region Projects & activity

Deno.test("projectState / projectStatusLabel / progressOf", () => {
	assertEquals(["active", "on_hold", "completed", "draft", "cancelled"].map(projectState), [
		"active",
		"active",
		"completed",
		"proposal",
		"proposal",
	]);
	assertEquals(projectStatusLabel("active", "in_progress"), "In progress");
	assertEquals(projectStatusLabel("active", "submitted"), "In review");
	assertEquals(projectStatusLabel("active", null), "Active");
	assertEquals(projectStatusLabel("on_hold", "in_progress"), "On hold");
	assertEquals(projectStatusLabel("completed", "paid"), "Completed");
	assertEquals(progressOf(1, 3), 1 / 3);
	assertEquals(progressOf(4, 3), 1);
	assertEquals(progressOf(0, 0), 0);
});

Deno.test("visibleActivity: money movements only for a viewer who may open Finance", () => {
	const events: RawActivity[] = [
		{ kind: "member", event: "joined", actor_user_id: "u1", at: daysAgo(1) },
		{
			kind: "money",
			event: "add_funds",
			actor_user_id: "u2",
			amount_minor: 1_000,
			currency: "USD",
			at: daysAgo(2),
		},
		{ kind: "member", event: "joined", actor_user_id: "u3", at: daysAgo(3) },
	];
	assertEquals(visibleActivity(events, true), events);
	assertEquals(visibleActivity(events, false).map((e) => e.actor_user_id), ["u1", "u3"]);
	assertEquals(visibleActivity([], false), []);
});

Deno.test("activityText: one line per event, money in its own currency", () => {
	assertEquals(
		activityText(
			{ kind: "member", event: "joined", actor_user_id: "u", at: daysAgo(1) },
			"Hannah Cole",
		),
		"Hannah Cole joined",
	);
	assertEquals(
		activityText({
			kind: "money",
			event: "add_funds",
			actor_user_id: "u",
			amount_minor: 6_000_000,
			currency: "USD",
			at: daysAgo(1),
		}, "Priya Raman"),
		"Priya Raman added US$60,000.00",
	);
});

Deno.test("relativeLabel: day buckets, weeks, then a date", () => {
	assertEquals(relativeLabel(daysAgo(0), NOW), "Today");
	assertEquals(relativeLabel(daysAgo(1), NOW), "Yesterday");
	assertEquals(relativeLabel(daysAgo(3), NOW), "3 days ago");
	assertEquals(relativeLabel(daysAgo(7), NOW), "1 week ago");
	assertEquals(relativeLabel(daysAgo(21), NOW), "3 weeks ago");
	assertEquals(relativeLabel("2025-01-02T00:00:00Z", NOW), "2 Jan 2025");
	assertEquals(relativeLabel("not a date", NOW), "");
});

// #endregion

// #region Split

Deno.test("deriveSplitModel: equal within one basis point over UNHELD stakes, else custom", () => {
	assertEquals(
		deriveSplitModel([{ shareBp: 3334, held: false }, { shareBp: 3333, held: false }, {
			shareBp: 3333,
			held: false,
		}]),
		"equal",
	);
	assertEquals(
		deriveSplitModel([{ shareBp: 5000, held: false }, { shareBp: 5000, held: false }]),
		"equal",
	);
	assertEquals(
		deriveSplitModel([{ shareBp: 4000, held: false }, { shareBp: 3000, held: false }, {
			shareBp: 3000,
			held: false,
		}]),
		"custom",
	);
	// A held stake is ignored: the two that move are even.
	assertEquals(
		deriveSplitModel([{ shareBp: 5000, held: true }, { shareBp: 2500, held: false }, {
			shareBp: 2500,
			held: false,
		}]),
		"equal",
	);
	assertEquals(deriveSplitModel([]), "custom");
});

Deno.test("evenSplit totals exactly 10 000 with the remainder on the owner", () => {
	const split = evenSplit(["a", "owner", "c"], "owner");
	assertEquals(split, [{ memberId: "a", shareBp: 3333 }, { memberId: "owner", shareBp: 3334 }, {
		memberId: "c",
		shareBp: 3333,
	}]);
	assertEquals(split.reduce((n, s) => n + s.shareBp, 0), 10_000);
	assertEquals(
		evenSplit(["a", "b", "c", "d", "e", "f", "g"], null).reduce((n, s) => n + s.shareBp, 0),
		10_000,
	);
	assertEquals(evenSplit(["x", "y", "z"], "not-a-member")[0].shareBp, 3334);
	assertEquals(evenSplit([], "o"), []);
});

Deno.test("toSplitRule reads the active template the way fn_team_split_plan applies it", () => {
	const none = { ruleType: "co_op", vaultBp: 0, finderUserId: null, finderBp: null } as const;
	assertEquals(toSplitRule(null), none);
	assertEquals(
		toSplitRule({ rule_type: "by_role", vault_bp: 900, finder_user_id: null, finder_bp: null }),
		none,
	);
	assertEquals(
		toSplitRule({ rule_type: "co_op", vault_bp: 1500, finder_user_id: null, finder_bp: null }),
		{ ruleType: "co_op", vaultBp: 1500, finderUserId: null, finderBp: null },
	);
	assertEquals(
		toSplitRule({
			rule_type: "finders_fee",
			vault_bp: 1000,
			finder_user_id: "u-1",
			finder_bp: 500,
		}),
		{ ruleType: "finders_fee", vaultBp: 1000, finderUserId: "u-1", finderBp: 500 },
	);
	// A finder's cut with no finder pays nobody in the plan, so none is reported.
	assertEquals(
		toSplitRule({ rule_type: "finders_fee", vault_bp: 1000, finder_user_id: null, finder_bp: 500 }),
		{ ruleType: "finders_fee", vaultBp: 1000, finderUserId: null, finderBp: null },
	);
	// Everything goes to the vault whatever was stored; stray finder fields are not reported.
	assertEquals(
		toSplitRule({
			rule_type: "benevolent_dictator",
			vault_bp: 0,
			finder_user_id: "u-1",
			finder_bp: 500,
		}),
		{ ruleType: "benevolent_dictator", vaultBp: 10_000, finderUserId: null, finderBp: null },
	);
	assertEquals(
		toSplitRule({ rule_type: "co_op", vault_bp: 12_000, finder_user_id: null, finder_bp: null })
			.vaultBp,
		10_000,
	);
});

Deno.test("projectedShare floors exactly as fn_team_split_plan does", () => {
	assertEquals(projectedShare(2_025_000, 4000), 810_000);
	assertEquals(projectedShare(1001, 3333), 333);
	assertEquals(projectedShare(0, 5000), 0);
	assertEquals(projectedShare(1000, 20_000), 1000);
});

/** mulberry32 — seeded, so a failing case reproduces from the seed. */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

Deno.test("projectedShare: over 500 seeded pools and stake sets, every cut is ⌊pool·bp/10000⌋ and the dust is under one unit a stake", () => {
	const next = mulberry32(20_261_016);
	const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
	for (let c = 0; c < 500; c++) {
		const pool = next() < 0.5
			? int(0, 1_000_000_000)
			: Math.floor(Math.exp(next() * Math.log(1_000_000_000)));
		const weights = Array.from(
			{ length: int(2, 15) },
			(_, i) => i > 0 && next() < 0.1 ? 0 : int(1, 1000),
		);
		const total = weights.reduce((a, b) => a + b, 0);
		const stakes = weights.map((w) => Math.floor((10_000 * w) / total));
		stakes[weights.findIndex((w) => w > 0)] += 10_000 - stakes.reduce((a, b) => a + b, 0);
		const label = `case ${c}: pool ${pool}, stakes ${stakes.join(",")}`;

		const cuts = stakes.map((bp) => projectedShare(pool, bp));
		cuts.forEach((cut, i) =>
			assertEquals(BigInt(cut), (BigInt(pool) * BigInt(stakes[i])) / 10_000n, label)
		);
		const dust = pool - cuts.reduce((a, b) => a + b, 0);
		const staked = stakes.filter((bp) => bp > 0).length;
		assertEquals(dust >= 0 && dust < staked, true, `${label}: dust ${dust} outside [0, ${staked})`);
	}
});

// #endregion

// #region Spend

Deno.test("spendRequestState: rejected → declined, a lapsed pending request is expired", () => {
	assertEquals(spendRequestState("approved", null, NOW), "approved");
	assertEquals(spendRequestState("rejected", null, NOW), "declined");
	assertEquals(spendRequestState("expired", null, NOW), "expired");
	assertEquals(spendRequestState("pending", daysAgo(-3), NOW), "pending");
	assertEquals(spendRequestState("pending", daysAgo(1), NOW), "expired");
	assertEquals(spendRequestState("pending", null, NOW), "pending");
});

Deno.test("spentInPeriod: a reset period has spent nothing; a total limit never resets", () => {
	assertEquals(spentInPeriod(800, "monthly", daysAgo(-5), NOW), 800);
	assertEquals(spentInPeriod(800, "monthly", daysAgo(1), NOW), 0);
	assertEquals(spentInPeriod(800, "total", daysAgo(1), NOW), 800);
	assertEquals(spentInPeriod(null, "weekly", null, NOW), 0);
	assertEquals(usedFraction(800, 2500), 0.32);
	assertEquals(usedFraction(5000, 2500), 1);
	assertEquals(usedFraction(800, null), 0);
});

// #endregion

// #region Workload & engagements (Decision #233)

Deno.test("wiOf / wiCapOf: numeric strings parse; nothing is 0; a cap is never 0", () => {
	assertEquals([wiOf("3.50"), wiOf(2), wiOf(null), wiOf("x"), wiOf(-1)], [3.5, 2, 0, 0, 0]);
	assertEquals([wiCapOf("12.00"), wiCapOf(null), wiCapOf(0)], [12, 10, 10]);
});

Deno.test("toEngagement: faces from people, W_i from the member row; non-members dropped; no cap is null", () => {
	const engagement = toEngagement(
		{
			project_slug: "prj-abc123",
			title: "",
			stage_slug: "stg-def456",
			stage_title: "Build",
			assignment_status: "accepted",
			project_status: "on_hold",
			stage_cap: "0",
			stage_wi: "4.00",
			assignees: [
				{ user_id: "u-a", stage_wi: "3.00" },
				{ user_id: "u-gone", stage_wi: "1.00" },
			],
		},
		new Map([["u-a", { username: "ana", name: "Ana", avatar: null }]]),
		new Map([["u-a", { wi: "7.25", wi_cap: null }]]),
	);
	assertEquals(engagement.title, "Untitled project");
	assertEquals(engagement.projectStatus, "on_hold");
	assertStrictEquals(engagement.stageCap, null);
	assertEquals(engagement.stageWi, 4);
	assertEquals(engagement.assignees, [{
		handle: "ana",
		displayName: "Ana",
		avatarUrl: "",
		wi: 7.25,
		wiCap: 10,
		stageWi: 3,
	}]);
});

// #endregion
