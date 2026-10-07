/**
 * The live layer's pure seams: the ONE refusal mapping every workspace RPC answer goes through, the
 * snake_case patches the write RPCs read (a key present is a change), and the two money-policy builders
 * over raw finance facts.
 */
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { refusalFrom, sentence, splitRefusal } from "./live-support.ts";
import { memberPatch, spendPatch } from "./live-writes.ts";
import {
	buildPayoutPolicy,
	buildSpendPolicy,
	type MoneyMember,
	type TeamMoneyFacts,
	trendOf,
} from "./live-money.ts";

const NOW = Date.parse("2026-09-28T12:00:00Z");

// #region Refusals

Deno.test("refusalFrom: 22023 is a field-keyed 422 with the sentence after `field: `", () => {
	const res = refusalFrom({
		code: "22023",
		message: "reportsTo: that would make a reporting loop",
	});
	assertEquals(res.status, 422);
	assertEquals(res.message, "That would make a reporting loop.");
	assertEquals(res.errors, { reportsTo: "That would make a reporting loop." });
});

Deno.test("refusalFrom: snake_case fields are camelCased; a subject prefix keys no field", () => {
	assertEquals(refusalFrom({ code: "22023", message: "spend_limit_minor: too big" }).errors, {
		spendLimitMinor: "Too big.",
	});
	assertEquals(
		refusalFrom({ code: "22023", message: "successor: choose another active member" }).errors,
		{
			successorMemberId: "Choose another active member.",
		},
	);
	const subject = refusalFrom({ code: "22023", message: "patch: expected an object" });
	assertEquals([subject.status, subject.errors], [422, undefined]);
});

Deno.test("refusalFrom: the status map", () => {
	assertEquals(
		refusalFrom({ code: "42501", message: "member: you cannot manage this member" }).status,
		403,
	);
	assertEquals(refusalFrom({ code: "42501", message: "auth: sign in first" }).status, 401);
	assertEquals(
		refusalFrom({ code: "P0002", message: "workspace: not found" }).message,
		"That workspace doesn't exist.",
	);
	assertEquals(refusalFrom({ code: "P0002", message: "invitation: not found" }).status, 404);
	const dup = refusalFrom({
		code: "23505",
		message: "handle: they already have a pending invitation",
	});
	assertEquals([dup.status, dup.errors?.handle], [409, "They already have a pending invitation."]);
	assertEquals(
		refusalFrom({ code: "55000", message: "plan: your plan includes 1 business — archive one" })
			.status,
		409,
	);
	assertEquals(refusalFrom({ code: "23514", message: "name: too long" }).status, 422);
	// The spend-decision function's own codes.
	assertEquals(
		refusalFrom({ code: "PB404", message: "That request no longer exists" }).status,
		404,
	);
	assertEquals(
		refusalFrom({ code: "PC409", message: "That request has already been decided" }).status,
		409,
	);
	assertEquals(refusalFrom({ code: "PGRST301", message: "JWT expired" }).status, 401);
});

Deno.test("refusalFrom: anything unexplained is a generic 500 that never echoes the database", () => {
	const original = console.error;
	console.error = () => {};
	try {
		const res = refusalFrom({
			code: "42P01",
			message: 'relation "org.secret_table" does not exist',
		});
		assertEquals(res.status, 500);
		assert(!res.message?.includes("secret_table"));
		assertStrictEquals(res.errors, undefined);
	} finally {
		console.error = original;
	}
});

Deno.test("sentence / splitRefusal", () => {
	assertEquals(
		sentence("the split must total 100% (it is over by 5%)"),
		"The split must total 100% (it is over by 5%)",
	);
	assertEquals(sentence("already done."), "Already done.");
	assertEquals(splitRefusal("roleId: choose one of this team's roles"), {
		field: "roleId",
		reason: "choose one of this team's roles",
	});
	assertStrictEquals(splitRefusal("Access Denied: nope"), null);
});

// #endregion

// #region Patches

Deno.test("memberPatch carries only the keys the input sets — null is a change, absent is not", () => {
	assertEquals(memberPatch({ kind: "team", workspaceId: "w", memberId: "m" }), {});
	assertEquals(
		memberPatch({
			kind: "business",
			workspaceId: "w",
			memberId: "m",
			title: null,
			reportsTo: null,
			spendLimitMinor: null,
			canSpend: true,
		}),
		{ title: null, reports_to: null, spend_limit_minor: null, can_spend: true },
	);
	assertEquals(
		memberPatch({
			kind: "team",
			workspaceId: "w",
			memberId: "m",
			roleId: "r",
			granted: ["view_audit"],
			remove: true,
		}),
		{
			role_id: "r",
			granted: ["view_audit"],
			remove: true,
		},
	);
});

Deno.test("spendPatch maps the spend policy onto save_spend_policy's keys", () => {
	assertEquals(spendPatch({ workspaceId: "b" }), {});
	assertEquals(
		spendPatch({
			workspaceId: "b",
			currency: "GBP",
			approvalThresholdMinor: null,
			approverIds: ["m1"],
			limits: [{ memberId: "m2", canSpend: true, limitMinor: 500, perTransactionMinor: null }],
		}),
		{
			currency: "GBP",
			approval_threshold_minor: null,
			approver_ids: ["m1"],
			limits: [{ member_id: "m2", can_spend: true, limit_minor: 500, per_transaction_minor: null }],
		},
	);
});

// #endregion

// #region Policies

const members: MoneyMember[] = [
	{
		memberId: "m-owner",
		userId: "u-owner",
		isOwner: true,
		person: { username: "kwame", name: "Kwame", avatar: null },
		capabilities: ["withdraw_funds", "approve_spend", "contribute_funds", "spend_funds"],
	},
	{
		memberId: "m-lead",
		userId: "u-lead",
		isOwner: false,
		person: { username: "sam", name: "Sam", avatar: null },
		capabilities: ["contribute_funds", "spend_funds"],
	},
	{ memberId: "m-new", userId: "u-new", isOwner: false, person: undefined, capabilities: [] },
];

Deno.test("buildPayoutPolicy: projected shares come from the preview plan; a member with no agreement holds 0", () => {
	const facts: TeamMoneyFacts = {
		agreements: new Map([["u-owner", { bp: 6000, held: false }], ["u-lead", {
			bp: 4000,
			held: false,
		}]]),
		preview: {
			gross_minor: 10_000,
			currency: "USD",
			fee_minor: 500,
			plan: {
				payout_minor: 9500,
				rule_type: "co_op",
				vault_bp: 1000,
				finder_user_id: null,
				finder_minor: 0,
				vault_minor: 950,
				members: [{ member_user_id: "u-owner", percent_bp: 6000, amount_minor: 5130 }, {
					member_user_id: "u-lead",
					percent_bp: 4000,
					amount_minor: 3420,
				}],
				dust_minor: 0,
				vault_total_minor: 950,
			},
		},
		walletCurrency: "USD",
		rule: { rule_type: "co_op", vault_bp: 1000 },
	};
	const policy = buildPayoutPolicy(members, facts);
	assertEquals(policy.stakes.map((s) => [s.memberId, s.shareBp, s.projected.minor]), [
		["m-owner", 6000, 5130],
		["m-lead", 4000, 3420],
		["m-new", 0, 0],
	]);
	assertEquals(policy.model, "custom");
	assertEquals([
		policy.projectedRelease?.minor,
		policy.platformFee?.minor,
		policy.vaultCut?.minor,
		policy.vaultBp,
	], [10_000, 500, 950, 1000]);
	assertEquals(policy.withdrawApprovers, ["m-owner"]);
	assertEquals(policy.templates.map((t) => [t.name, t.isDefault]), [["Current split", true], [
		"Even split",
		false,
	]]);
	const even = policy.templates[1].stakes;
	assertEquals(even.map((s) => s.shareBp), [3334, 3333, 3333]);
	// The pool the plan divides: 9500 payout − 950 vault = 8550.
	assertEquals(even.map((s) => s.projected.minor), [2850, 2849, 2849]);
});

Deno.test("buildPayoutPolicy: no release held → nothing projected, but the standing vault rule still shows", () => {
	const policy = buildPayoutPolicy(members.slice(0, 2), {
		agreements: new Map([["u-owner", { bp: 5000, held: false }], ["u-lead", {
			bp: 5000,
			held: false,
		}]]),
		preview: {
			gross_minor: null,
			currency: null,
			fee_minor: null,
			plan: {
				payout_minor: 0,
				rule_type: null,
				vault_bp: 0,
				finder_user_id: null,
				finder_minor: 0,
				vault_minor: 0,
				members: [],
				dust_minor: 0,
				vault_total_minor: 0,
			},
		},
		walletCurrency: "GBP",
		rule: { rule_type: "co_op", vault_bp: 1500 },
	});
	assertEquals([policy.projectedRelease, policy.platformFee, policy.vaultCut], [null, null, null]);
	assertEquals(policy.vaultBp, 1500);
	assertEquals(
		policy.stakes.every((s) => s.projected.minor === 0 && s.projected.currency === "GBP"),
		true,
	);
	assertEquals(policy.model, "equal");
	// The current split IS the even split, so no duplicate template is offered.
	assertEquals(policy.templates.length, 1);
});

Deno.test("buildSpendPolicy: capabilities decide approvers/contributors/spenders; rejected → declined; ledger merged", () => {
	const people = new Map([
		["u-owner", { username: "kwame", name: "Kwame", avatar: null }],
		["u-lead", { username: "sam", name: "Sam", avatar: null }],
	]);
	const policy = buildSpendPolicy(
		members,
		{
			currency: "USD",
			wallets: [{ id: "w1", currency: "USD", approval_threshold_cents: 0 }],
			limits: [{
				wallet_id: "w1",
				member_user_id: "u-lead",
				cap_cents: 2500,
				per_transaction_cents: 1000,
				period_interval: "monthly",
				spent_cents: 800,
				resets_at: "2026-10-07T00:00:00Z",
			}],
			audit: [{
				id: "a1",
				wallet_id: "w1",
				actor_user_id: "u-owner",
				amount_cents: 6000,
				currency: "USD",
				metadata: { note: "Q4 budget" },
				created_at: "2026-08-29T00:00:00Z",
			}],
			debits: [{
				id: "d1",
				wallet_id: "w1",
				amount_cents: 800,
				currency: "USD",
				reason: "escrow_hold",
				created_at: "2026-09-20T00:00:00Z",
			}],
			approvals: [
				{
					id: "s1",
					wallet_id: "w1",
					requested_by: "u-lead",
					amount_cents: 1600,
					currency: "USD",
					reason: "Fund a stage",
					status: "rejected",
					approver_user_id: "u-owner",
					decided_at: "2026-09-27T00:00:00Z",
					expires_at: null,
					created_at: "2026-09-26T00:00:00Z",
				},
				{
					id: "s2",
					wallet_id: "w1",
					requested_by: "u-lead",
					amount_cents: 900,
					currency: "USD",
					reason: "More",
					status: "pending",
					approver_user_id: null,
					decided_at: null,
					expires_at: "2026-10-01T00:00:00Z",
					created_at: "2026-09-27T00:00:00Z",
				},
			],
		},
		people,
		"verified",
		NOW,
	);
	assertStrictEquals(policy.approvalThresholdMinor, null);
	assertEquals(policy.approverIds, ["m-owner"]);
	assertEquals(policy.contributorIds, ["m-owner", "m-lead"]);
	assertEquals(
		policy.limits.map((
			l,
		) => [
			l.memberId,
			l.canSpend,
			l.limitMinor,
			l.spent.minor,
			l.usedFraction,
			l.perTransactionMinor,
		]),
		[
			["m-owner", true, null, 0, 0, null],
			["m-lead", true, 2500, 800, 0.32, 1000],
			["m-new", false, null, 0, 0, null],
		],
	);
	assertEquals(policy.entries.map((e) => [e.kind, e.memberId, e.reason]), [[
		"spend",
		null,
		"Escrow funded",
	], ["contribution", "m-owner", "Q4 budget"]]);
	assertEquals(policy.requests.map((r) => [r.id, r.state, r.memberId, r.decidedBy, r.approvers]), [
		["s2", "pending", "m-lead", null, ["Kwame"]],
		["s1", "declined", "m-lead", "Kwame", ["Kwame"]],
	]);
	assertStrictEquals(policy.verificationPrompt, null);
});

Deno.test("trendOf: earnings for a team, spend for a business, empty when nothing moved", () => {
	const flow = [{ label: "a", start: "2026-10-01", inMinor: 0, outMinor: 50, netMinor: -50 }, {
		label: "b",
		start: "2026-10-02",
		inMinor: 200,
		outMinor: 100,
		netMinor: 100,
	}];
	assertEquals(trendOf("team", flow), [0, 1]);
	assertEquals(trendOf("business", flow), [0.5, 1]);
	assertEquals(
		trendOf("team", [{ label: "a", start: "2026-10-01", inMinor: 0, outMinor: 9, netMinor: -9 }]),
		[],
	);
});

// #endregion
