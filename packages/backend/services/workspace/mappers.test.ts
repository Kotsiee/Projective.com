/**
 * The pure rules of the live workspace console (`mappers.ts`): roster stats, the create allowance, the
 * setup checklist, split derivation, the even-split template, spend-request states, and the smaller
 * parsers — each pinned against the behaviour the console depends on, with an injected clock.
 */
import { assertEquals, assertStrictEquals } from "@std/assert";
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
	relativeLabel,
	rosterStats,
	setupCompletion,
	setupSteps,
	spendRequestState,
	spentInPeriod,
	toOutgoingInvite,
	toRoleDef,
	usedFraction,
	verificationPrompt,
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

Deno.test("setupSteps: five steps, identity to the profile editor, the rest to their modules, by handle", () => {
	const steps = setupSteps("team", "northloop", {
		logo: true,
		bio: false,
		invite: true,
		money: false,
		verified: false,
	});
	assertEquals(steps.map((s) => s.id), ["logo", "bio", "invite", "money", "verification"]);
	assertEquals(steps.map((s) => s.href), [
		"/@northloop/edit",
		"/@northloop/edit",
		"/teams/northloop/invitations",
		"/teams/northloop/payouts",
		"/teams/northloop/verification",
	]);
	assertEquals(steps.map((s) => s.done), [true, false, true, false, false]);
	assertEquals(setupCompletion(steps), 0.4);
	const biz = setupSteps("business", "helia", {
		logo: true,
		bio: true,
		invite: true,
		money: true,
		verified: true,
	});
	assertEquals(biz[3].href, "/businesses/helia/spend");
	assertEquals(biz[4].label, "Finish KYB");
	assertEquals(setupCompletion(biz), 1);
	assertEquals(setupCompletion([]), 1);
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

Deno.test("projectedShare floors exactly as fn_team_split_plan does", () => {
	assertEquals(projectedShare(2_025_000, 4000), 810_000);
	assertEquals(projectedShare(1001, 3333), 333);
	assertEquals(projectedShare(0, 5000), 0);
	assertEquals(projectedShare(1000, 20_000), 1000);
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
