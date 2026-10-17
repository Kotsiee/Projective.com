/**
 * The live layer's pure seams: the ONE refusal mapping every workspace RPC answer goes through, the
 * snake_case patches the write RPCs read (a key present is a change), and the two money-policy builders
 * over raw finance facts.
 */
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import type { WorkspaceFinance } from "@projective/types/workspace";
import { detailIo, readDetail } from "./live-detail.ts";
import type { LiveActor } from "./live-support.ts";
import type { RawDetail } from "./mappers.ts";
import { refusalFrom, sentence, splitRefusal } from "./live-support.ts";
import { memberPatch, spendPatch, splitRuleArgs } from "./live-writes.ts";
import {
	buildPayoutPolicy,
	buildSpendPolicy,
	type MoneyMember,
	type RawApproval,
	type RawBusinessSpend,
	type RawEnvelope,
	type SpendMember,
	type TeamMoneyFacts,
	toKyb,
	toMoneyTile,
	toSpendLimit,
	toViewerCan,
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

Deno.test("refusalFrom: a plan gate's PK402 is a 402 naming the entitlement the plan lacks", () => {
	const res = refusalFrom({
		code: "PK402",
		message: "entitlement: this split template is part of Pro Team — upgrade the team to use it",
		hint: "split_template_finders_fee",
	});
	assertEquals(res.status, 402);
	assertEquals(
		res.message,
		"This split template is part of Pro Team — upgrade the team to use it.",
	);
	assertEquals(res.errors, undefined);
	assertEquals(res.details, { reason: "entitlement", entitlement: "split_template_finders_fee" });
});

Deno.test("refusalFrom: the Teams persona gate is a 403 carrying the `persona` code", () => {
	const res = refusalFrom({
		code: "PK403",
		message: "persona_not_freelancer: Teams are for freelancer accounts",
		hint: "self",
		details: "operator",
	});
	assertEquals(res.status, 403);
	assertEquals(res.message, "Teams are for freelancer accounts.");
	assertEquals(res.details, { reason: "persona", actor: "self", persona: "operator" });
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
		rule: { rule_type: "co_op", vault_bp: 1000, finder_user_id: null, finder_bp: null },
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
	assertEquals(policy.rule, {
		ruleType: "co_op",
		vaultBp: 1000,
		finderUserId: null,
		finderBp: null,
	});
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
		rule: { rule_type: "co_op", vault_bp: 1500, finder_user_id: null, finder_bp: null },
	});
	assertEquals([policy.projectedRelease, policy.platformFee, policy.vaultCut], [null, null, null]);
	assertEquals(policy.vaultBp, 1500);
	assertEquals(policy.rule, {
		ruleType: "co_op",
		vaultBp: 1500,
		finderUserId: null,
		finderBp: null,
	});
	assertEquals(
		policy.stakes.every((s) => s.projected.minor === 0 && s.projected.currency === "GBP"),
		true,
	);
	assertEquals(policy.model, "equal");
	// The current split IS the even split, so no duplicate template is offered.
	assertEquals(policy.templates.length, 1);
});

Deno.test("buildPayoutPolicy: the active template travels in the payout block; none stored reads as co_op 0", () => {
	const facts = (rule: TeamMoneyFacts["rule"]): TeamMoneyFacts => ({
		agreements: new Map([["u-owner", { bp: 10_000, held: false }]]),
		preview: null,
		walletCurrency: "GBP",
		rule,
	});
	const finders = buildPayoutPolicy(
		members.slice(0, 2),
		facts({ rule_type: "finders_fee", vault_bp: 1000, finder_user_id: "u-lead", finder_bp: 500 }),
	);
	assertEquals(finders.rule, {
		ruleType: "finders_fee",
		vaultBp: 1000,
		finderUserId: "u-lead",
		finderBp: 500,
	});
	assertEquals(finders.vaultBp, 1000);

	const dictator = buildPayoutPolicy(
		members.slice(0, 2),
		facts({ rule_type: "benevolent_dictator", vault_bp: 0, finder_user_id: null, finder_bp: null }),
	);
	assertEquals([dictator.rule.ruleType, dictator.rule.vaultBp, dictator.vaultBp], [
		"benevolent_dictator",
		10_000,
		10_000,
	]);

	const none = buildPayoutPolicy(members.slice(0, 2), facts(null));
	assertEquals(none.rule, { ruleType: "co_op", vaultBp: 0, finderUserId: null, finderBp: null });
	assertEquals(none.vaultBp, 0);
});

Deno.test("splitRuleArgs: a finder travels only under finders_fee; benevolent_dictator sends 10 000", () => {
	assertEquals(splitRuleArgs("t1", { ruleType: "co_op", vaultBp: 1500 }), {
		p_team_id: "t1",
		p_rule_type: "co_op",
		p_vault_bp: 1500,
	});
	assertEquals(
		splitRuleArgs("t1", {
			ruleType: "finders_fee",
			vaultBp: 1000,
			finderUserId: "u2",
			finderBp: 500,
		}),
		{
			p_team_id: "t1",
			p_rule_type: "finders_fee",
			p_vault_bp: 1000,
			p_finder_user_id: "u2",
			p_finder_bp: 500,
		},
	);
	assertEquals(splitRuleArgs("t1", { ruleType: "benevolent_dictator" }), {
		p_team_id: "t1",
		p_rule_type: "benevolent_dictator",
		p_vault_bp: 10_000,
	});
});

Deno.test("splitRuleArgs names exactly the parameters finance.save_split_rule declares", () => {
	const sql = Deno.readTextFileSync(
		new URL(
			"../../../../supabase/migrations/00001210_functions_finance_kyc_wallet.sql",
			import.meta.url,
		),
	);
	const start = sql.indexOf("CREATE OR REPLACE FUNCTION finance.save_split_rule(");
	assert(start >= 0, "finance.save_split_rule is no longer defined");
	const signature = sql.slice(start, sql.indexOf("RETURNS", start));
	const declared = [...signature.matchAll(/\b(p_[a-z_]+)\s/g)].map((m) => m[1]);
	assertEquals(declared, [
		"p_team_id",
		"p_rule_type",
		"p_vault_bp",
		"p_finder_user_id",
		"p_finder_bp",
	]);
	const sent = Object.keys(
		splitRuleArgs("t1", { ruleType: "finders_fee", vaultBp: 0, finderUserId: "u", finderBp: 1 }),
	);
	assertEquals(sent, declared);
});

/** The business members the spend builder resolves faces from. */
const spendMembers: SpendMember[] = members.map(({ memberId, userId, person }) => ({
	memberId,
	userId,
	person,
}));

/** One raw envelope as `finance.fn_business_envelopes` answers it. */
function envelope(memberId: string, userId: string, extra: Partial<RawEnvelope> = {}): RawEnvelope {
	return {
		member_id: memberId,
		user_id: userId,
		can_spend: false,
		limit_minor: null,
		per_transaction_minor: null,
		period: "monthly",
		spent_minor: 0,
		remaining_minor: null,
		used_fraction: 0,
		...extra,
	};
}

Deno.test("buildSpendPolicy: the SQL's envelopes, approvers and queue — mapped, never recomputed", () => {
	const people = new Map([
		["u-owner", { username: "kwame", name: "Kwame", avatar: null }],
		["u-lead", { username: "sam", name: "Sam", avatar: null }],
	]);
	const approval = (id: string, status: string, extra: Partial<RawApproval> = {}): RawApproval => ({
		id,
		requested_by: "u-lead",
		amount_minor: 1600,
		currency: "usd",
		reason: "Fund a stage",
		status,
		approver_user_id: null,
		decided_at: null,
		expires_at: null,
		created_at: "2026-09-26T00:00:00Z",
		...extra,
	});
	const policy = buildSpendPolicy(
		{
			currency: "usd",
			approval_threshold_minor: null,
			platform_threshold_minor: "50000",
			approver_user_ids: ["u-owner"],
			contributor_user_ids: ["u-owner", "u-lead"],
			limits: [
				envelope("m-owner", "u-owner", { can_spend: true }),
				envelope("m-lead", "u-lead", {
					can_spend: true,
					limit_minor: 2500,
					per_transaction_minor: "1000",
					spent_minor: 800,
					remaining_minor: 1700,
					used_fraction: "0.32",
				}),
			],
			contributed: [{ user_id: "u-owner", minor: "6000" }],
			contributions: [{
				id: "a1",
				actor_user_id: "u-owner",
				amount_minor: 6000,
				currency: "USD",
				note: "Q4 budget",
				kind: null,
				at: "2026-08-29T00:00:00Z",
			}, {
				id: "a2",
				actor_user_id: "u-lead",
				amount_minor: 100,
				currency: "USD",
				note: null,
				kind: "card_topup",
				at: "2026-08-30T00:00:00Z",
			}],
			debits: [{
				id: "d1",
				amount_minor: 800,
				currency: "USD",
				reason: "escrow_hold",
				at: "2026-09-20T00:00:00Z",
			}],
			approvals: {
				pending: [approval("s2", "pending", { amount_minor: 900 })],
				decided: [approval("s1", "rejected", {
					approver_user_id: "u-owner",
					decided_at: "2026-09-27T00:00:00Z",
				})],
			},
		},
		spendMembers,
		people,
		"verified",
		NOW,
	);
	assertEquals(policy.currency, "USD");
	assertStrictEquals(policy.approvalThresholdMinor, null);
	assertStrictEquals(policy.platformThresholdMinor, 50_000);
	assertEquals([policy.approverIds, policy.approverHandles], [["m-owner"], ["kwame"]]);
	assertEquals([policy.contributorIds, policy.contributorHandles], [["m-owner", "m-lead"], [
		"kwame",
		"sam",
	]]);
	assertEquals(
		policy.limits.map((l) => [
			l.memberId,
			l.canSpend,
			l.limitMinor,
			l.period,
			l.spentMinor,
			l.remainingMinor,
			l.usedFraction,
			l.perTransactionMinor,
		]),
		[
			["m-owner", true, null, "monthly", 0, null, 0, null],
			["m-lead", true, 2500, "monthly", 800, 1700, 0.32, 1000],
		],
	);
	assertEquals(policy.entries.map((e) => [e.kind, e.memberId, e.reason]), [
		["spend", null, "Escrow funded"],
		["contribution", "m-lead", "Added by card"],
		["contribution", "m-owner", "Q4 budget"],
	]);
	assertEquals(policy.approvals.pending.map((r) => [r.id, r.state, r.memberId, r.approvers]), [
		["s2", "pending", "m-lead", ["Kwame"]],
	]);
	assertEquals(policy.approvals.decided.map((r) => [r.id, r.state, r.decidedBy]), [
		["s1", "declined", "Kwame"],
	]);
	assertStrictEquals(policy.verificationPrompt, null);
});

Deno.test("toSpendLimit: no ceiling has no remainder; a drifted period reads monthly; the fraction is clamped", () => {
	const limit = toSpendLimit(
		envelope("m", "u", { period: "fortnightly", used_fraction: "7", spent_minor: "-5" }),
		undefined,
		"EUR",
	);
	assertEquals(
		[limit.limitMinor, limit.remainingMinor, limit.period, limit.usedFraction, limit.spentMinor],
		[null, null, "monthly", 1, 0],
	);
	assertEquals(limit.name, "Member");
	assertEquals(limit.spent.currency, "EUR");
});

Deno.test("toViewerCan: only an explicit true grants — a missing or null flag is a refusal", () => {
	const can = toViewerCan({ edit_policy: true, decide: null, start_kyb: true, archive: false });
	assertEquals(can, {
		editPolicy: true,
		decide: false,
		requestSpend: false,
		payInvoice: false,
		startKyb: true,
		hire: false,
		purchase: false,
		manageProjects: false,
		archive: false,
	});
	assertEquals(Object.values(toViewerCan(null)).every((v) => v === false), true);
});

Deno.test("toKyb: the resume link only for a startKyb holder whose business has an account", () => {
	const raw = {
		status: "pending",
		verified_at: null,
		has_account: true,
		requirements_due: ["finish_onboarding", "something_new"],
	};
	const kyb = toKyb(raw, "b-1", true);
	assertEquals(kyb.status, "pending");
	assertEquals(kyb.requirementsDue, ["finish_onboarding"]);
	assertEquals(
		kyb.connectOnboardingUrl,
		"/api/finance/connect/refresh?scope=business&businessId=b-1&back=settings",
	);
	assertStrictEquals(toKyb(raw, "b-1", false).connectOnboardingUrl, null);
	assertStrictEquals(toKyb({ ...raw, has_account: false }, "b-1", true).connectOnboardingUrl, null);
	assertEquals(toKyb({ ...raw, status: "rejected" }, "b-1", true).status, "unverified");
});

Deno.test("toMoneyTile: every figure in its own currency, never a negative", () => {
	const tile = toMoneyTile({
		currency: "gbp",
		available_minor: "12000",
		pending_minor: null,
		committed_minor: 5000,
		awaiting_approval_minor: 900,
		spent_30d_minor: -1,
	});
	assertEquals(
		[tile.currency, tile.available.minor, tile.pending.minor, tile.committed.minor],
		["GBP", 12_000, 0, 5000],
	);
	assertEquals([tile.awaitingApproval.minor, tile.spent30d.minor, tile.spent30d.currency], [
		900,
		0,
		"GBP",
	]);
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

// #region The one console read (Decision #233)

/** A raw `org.get_workspace_detail` team answer, as the definer returns it, for the given viewer. */
function rawTeamDetail(withPayout: boolean): RawDetail {
	const member = (id: string, userId: string, role: string, wi: number, share: number) => ({
		id,
		user_id: userId,
		role_id: `r-${role}`,
		role,
		status: "active",
		granted: [],
		revoked: [],
		joined_at: "2026-09-01T00:00:00Z",
		title: null,
		reports_to: null,
		is_self: userId === "u-owner",
		email: null,
		wi,
		wi_cap: "10.00",
		availability: "available",
		share_bp: share,
		share_held: false,
	});
	return {
		status: "ok",
		id: "team-1",
		name: "Northloop",
		handle: "northloop",
		avatar_file_id: null,
		banner_file_id: null,
		headline: "",
		entity_status: "active",
		owner_user_id: "u-owner",
		created_at: "2026-09-01T00:00:00Z",
		verification: "unverified",
		viewer: { member_id: "m-owner", role_id: "r-owner", capabilities: ["manage_finances"] },
		members: [
			member("m-owner", "u-owner", "owner", 2, 6000),
			member("m-lead", "u-lead", "member", 1, 4000),
		],
		roles: [],
		invites: [],
		standing: null,
		projects: [{
			slug: "prj-abc123",
			title: "Atlas",
			status: "active",
			client_business_id: "biz-1",
			owner_user_id: "u-client",
			stage_name: "Build",
			stage_status: "in_progress",
			due: null,
			stages_total: 2,
			stages_done: 1,
			client: { name: "Atlas Labs", avatar_bucket: null, avatar_path: null },
		}],
		activity: [],
		setup: { logo: false, bio: false, invite: true, money: true },
		engagements: [{
			project_slug: "prj-abc123",
			title: "Atlas",
			stage_slug: "stg-def456",
			stage_title: "Build",
			assignment_status: "accepted",
			project_status: "active",
			stage_cap: null,
			stage_wi: "3.00",
			assignees: [{ user_id: "u-owner", stage_wi: "2.00" }, { user_id: "u-lead", stage_wi: 1 }],
		}],
		payout: withPayout
			? {
				rule: { rule_type: "co_op", vault_bp: 1000, finder_user_id: null, finder_bp: null },
				wallet: { id: "w-1", currency: "usd", available_minor: 285_618, pending_minor: 0 },
				preview: null,
			}
			: null,
		allowance: null,
	};
}

const FINANCE_TILES: WorkspaceFinance = {
	available: { minor: 0, currency: "USD", display: "$0.00", origin: null },
	locked: { minor: 0, currency: "USD", display: "$0.00", origin: null },
	pending: { minor: 0, currency: "USD", display: "$0.00", origin: null },
	walletHref: "/wallet?w=team:team-1",
	trend: [],
	delta: null,
};

/** Run one detail read with every outside reach stubbed; returns the result and the RPC spy. */
async function readStubbed(raw: RawDetail, kind: "team" | "business" = "team") {
	const rpc = stub(
		detailIo,
		"rpc",
		// deno-lint-ignore require-await
		(async () => ({ ok: true, data: raw })) as unknown as typeof detailIo.rpc,
	);
	const tiles = stub(detailIo, "financeTiles", () => Promise.resolve(FINANCE_TILES));
	const media = stub(detailIo, "publicMedia", () => Promise.resolve(new Map()));
	const cards = stub(detailIo, "partyCards", () =>
		Promise.resolve(
			new Map(["u-owner", "u-lead", "u-new"].map((id) => [id, {
				userId: id,
				username: id.slice(2),
				name: id === "u-owner" ? "Kwame" : id === "u-lead" ? "Sam" : "Noor",
				isFreelancer: true,
				avatar: null,
				avatarLarge: null,
			}])),
		));
	try {
		const actor = {
			userId: "u-owner",
			contextId: "",
			contextType: "personal",
			accessToken: "test",
		} as unknown as LiveActor;
		const res = await readDetail(kind, raw.handle, actor, { nowMs: NOW });
		return {
			res,
			detail: res.ok ? res.data ?? null : null,
			rpcCalls: rpc.calls.length,
			rpcArgs: rpc.calls[0]?.args,
		};
	} finally {
		rpc.restore();
		tiles.restore();
		media.restore();
		cards.restore();
	}
}

Deno.test("readDetail: one RPC per detail read — get_workspace_detail, nothing else", async () => {
	const { res, rpcCalls, rpcArgs } = await readStubbed(rawTeamDetail(true));
	assert(res.ok);
	assertEquals(rpcCalls, 1);
	assertEquals(rpcArgs?.slice(1), ["org", "get_workspace_detail", {
		p_kind: "team",
		p_handle: "northloop",
	}]);
});

Deno.test("readDetail: the payout block maps the rule, the vault wallet and the members' stakes", async () => {
	const { detail } = await readStubbed(rawTeamDetail(true));
	assert(detail);
	const payout = detail.payout;
	assert(payout);
	assertEquals(
		[payout.walletId, payout.currency, payout.availableMinor, payout.pendingMinor],
		["w-1", "USD", 285_618, 0],
	);
	assertEquals([payout.rule.ruleType, payout.rule.vaultBp, payout.vaultBp], ["co_op", 1000, 1000]);
	assertEquals(payout.stakes.map((s) => [s.memberId, s.shareBp]), [["m-owner", 6000], [
		"m-lead",
		4000,
	]]);
});

Deno.test("readDetail: a member without manage_finances receives no payout block", async () => {
	const { detail } = await readStubbed(rawTeamDetail(false));
	assert(detail);
	assertStrictEquals(detail.payout, null);
	// The roster still shows each member's stake and W_i — those are not the payout block.
	assertEquals(detail.members.map((m) => [m.handle, m.shareBp, m.wi, m.wiCap, m.workload]), [
		["owner", 6000, 2, 10, 20],
		["lead", 4000, 1, 10, 10],
	]);
});

Deno.test("readDetail: engagements carry slugs and faces, never a user id", async () => {
	const { detail } = await readStubbed(rawTeamDetail(true));
	assert(detail);
	assertEquals(detail.engagements.length, 1);
	const [engagement] = detail.engagements;
	assertEquals([engagement.projectSlug, engagement.stageSlug, engagement.stageWi], [
		"prj-abc123",
		"stg-def456",
		3,
	]);
	assertEquals(
		engagement.assignees.map((a) => [a.handle, a.displayName, a.wi, a.wiCap, a.stageWi]),
		[["owner", "Kwame", 2, 10, 2], ["lead", "Sam", 1, 10, 1]],
	);
	assert(!JSON.stringify(detail.engagements).includes("u-owner"));
	assertEquals(detail.projects[0].counterparty, "Atlas Labs");
	assertStrictEquals(detail.allowance, null);
});

// #endregion

// #region The business console read (BB9)

type BusinessViewer = "owner" | "admin" | "member" | "spender";

/** The viewer flags the definer answers, by viewer. */
const FLAGS: Record<BusinessViewer, Record<string, boolean>> = {
	owner: {
		edit_policy: true,
		decide: true,
		request_spend: true,
		pay_invoice: true,
		start_kyb: true,
		hire: true,
		purchase: true,
		manage_projects: true,
		archive: false,
	},
	admin: {
		edit_policy: true,
		decide: true,
		request_spend: true,
		pay_invoice: false,
		start_kyb: false,
		hire: true,
		purchase: true,
		manage_projects: true,
		archive: false,
	},
	member: {
		edit_policy: false,
		decide: false,
		request_spend: false,
		pay_invoice: false,
		start_kyb: false,
		hire: false,
		purchase: false,
		manage_projects: false,
		archive: false,
	},
	spender: {
		edit_policy: false,
		decide: false,
		request_spend: true,
		pay_invoice: false,
		start_kyb: false,
		hire: false,
		purchase: false,
		manage_projects: false,
		archive: false,
	},
};

/**
 * A raw `org.get_workspace_detail` business answer AS THE DEFINER NARROWS IT for each viewer: the
 * owner and an admin read every envelope and the whole queue; a plain member (contribute_funds only)
 * cannot open Spend, so receives no spend block; a member granted spend_funds reads only their own
 * envelope and requests.
 */
function rawBusinessDetail(viewer: BusinessViewer): RawDetail {
	const self = { owner: "u-owner", admin: "u-lead", member: "u-new", spender: "u-new" }[viewer];
	const member = (id: string, userId: string, role: string) => ({
		id,
		user_id: userId,
		role_id: `r-${role}`,
		role,
		status: "active",
		granted: viewer === "spender" && userId === "u-new" ? ["spend_funds"] : [],
		revoked: [],
		joined_at: "2026-09-01T00:00:00Z",
		title: null,
		reports_to: null,
		is_self: userId === self,
		email: null,
		wi: 0,
		wi_cap: "10.00",
		availability: "available",
		share_bp: null,
		share_held: null,
	});
	const allEnvelopes = [
		envelope("m-owner", "u-owner", { can_spend: true }),
		envelope("m-lead", "u-lead", { can_spend: true, limit_minor: 50_000, remaining_minor: 50_000 }),
		envelope("m-new", "u-new", {
			can_spend: viewer === "spender",
			limit_minor: 10_000,
			spent_minor: 2500,
			remaining_minor: 7500,
			used_fraction: 0.25,
		}),
	];
	const reads = viewer === "owner" || viewer === "admin";
	const spend: RawBusinessSpend = {
		currency: "USD",
		approval_threshold_minor: 100_000,
		platform_threshold_minor: null,
		approver_user_ids: ["u-owner", "u-lead"],
		contributor_user_ids: ["u-owner", "u-lead", "u-new"],
		limits: reads ? allEnvelopes : allEnvelopes.filter((l) => l.user_id === self),
		contributed: [{ user_id: "u-owner", minor: 250_000 }],
		contributions: [],
		debits: [],
		approvals: { pending: [], decided: [] },
	};
	const tile = (currency: string, available: number, committed: number, spent: number) => ({
		currency,
		available_minor: available,
		pending_minor: 0,
		committed_minor: committed,
		awaiting_approval_minor: 0,
		spent_30d_minor: spent,
	});
	return {
		status: "ok",
		id: "biz-1",
		name: "Atlas Labs",
		handle: "atlas-labs",
		avatar_file_id: null,
		banner_file_id: null,
		headline: "",
		entity_status: "active",
		visibility: "invite_only",
		owner_user_id: "u-owner",
		created_at: "2026-09-01T00:00:00Z",
		verification: "verified",
		viewer: {
			member_id: { owner: "m-owner", admin: "m-lead", member: "m-new", spender: "m-new" }[viewer],
			role_id: viewer === "owner" ? "r-owner" : viewer === "admin" ? "r-admin" : "r-member",
			capabilities: [],
		},
		members: [
			member("m-owner", "u-owner", "owner"),
			member("m-lead", "u-lead", "admin"),
			member("m-new", "u-new", "member"),
		],
		roles: [],
		invites: [],
		standing: null,
		projects: [],
		activity: [],
		setup: { logo: false, bio: false, invite: true, money: true },
		engagements: [],
		payout: null,
		allowance: null,
		archive_blockers: viewer === "owner" ? [{ code: "wallet_balance", count: 2 }] : [],
		spend: viewer === "member" ? null : spend,
		money_tiles: [tile("USD", 250_000, 40_000, 12_000), tile("EUR", 900, 0, 0)],
		kyb: {
			status: "verified",
			verified_at: "2026-09-02T00:00:00Z",
			has_account: true,
			requirements_due: [],
		},
		viewer_can: FLAGS[viewer],
	};
}

Deno.test("readDetail (business): one RPC per detail read — the spend facts ride the console read", async () => {
	for (const viewer of ["owner", "admin", "member", "spender"] as const) {
		const { res, rpcCalls, rpcArgs } = await readStubbed(rawBusinessDetail(viewer), "business");
		assert(res.ok, viewer);
		assertEquals(rpcCalls, 1, `${viewer}: exactly one RPC`);
		assertEquals(rpcArgs?.slice(1), ["org", "get_workspace_detail", {
			p_kind: "business",
			p_handle: "atlas-labs",
		}]);
	}
});

Deno.test("readDetail (business): the owner reads every envelope, the tiles in every currency, the flags", async () => {
	const { detail } = await readStubbed(rawBusinessDetail("owner"), "business");
	assert(detail?.spend);
	assertEquals(detail.spend.limits.map((l) => [l.handle, l.limitMinor, l.remainingMinor]), [
		["owner", null, null],
		["lead", 50_000, 50_000],
		["new", 10_000, 7500],
	]);
	assertEquals(detail.spend.approverHandles, ["owner", "lead"]);
	assertEquals(detail.moneyTiles.map((t) => [t.currency, t.available.minor, t.committed.minor]), [
		["USD", 250_000, 40_000],
		["EUR", 900, 0],
	]);
	assertEquals(detail.members.map((m) => [m.handle, m.spendLimitMinor, m.contributedMinor]), [
		["owner", null, 250_000],
		["lead", 50_000, 0],
		["new", 10_000, 0],
	]);
	assert(detail.viewerCan?.payInvoice && detail.viewerCan.startKyb && !detail.viewerCan.archive);
	assertEquals(detail.archiveBlockers, [{ code: "wallet_balance", count: 2 }]);
	assert(detail.kyb?.connectOnboardingUrl?.startsWith("/api/finance/connect/refresh?"));
});

Deno.test("readDetail (business): an admin decides and edits but cannot pay or start KYB", async () => {
	const { detail } = await readStubbed(rawBusinessDetail("admin"), "business");
	assert(detail?.viewerCan);
	const can = detail.viewerCan;
	assertEquals([can.editPolicy, can.decide, can.payInvoice, can.startKyb], [
		true,
		true,
		false,
		false,
	]);
	assertStrictEquals(detail.kyb?.connectOnboardingUrl, null);
	assertEquals(detail.spend?.limits.length, 3);
	assertEquals(detail.archiveBlockers, []);
});

Deno.test("readDetail (business): a plain member sees no envelope, no queue, nobody's ceiling", async () => {
	const { detail } = await readStubbed(rawBusinessDetail("member"), "business");
	assert(detail);
	assertStrictEquals(detail.spend, null);
	assert(detail.members.every((m) => m.spendLimitMinor === null), "no member's ceiling leaks");
	assert(detail.viewerCan && Object.values(detail.viewerCan).every((v) => v === false));
	// Finance is theirs to open (contribute_funds), so the tiles are.
	assertEquals(detail.moneyTiles.length, 2);
});

Deno.test("readDetail (business): a member who may spend reads only their own envelope", async () => {
	const { detail } = await readStubbed(rawBusinessDetail("spender"), "business");
	assert(detail?.spend);
	assertEquals(detail.spend.limits.map((l) => [l.memberId, l.spentMinor, l.usedFraction]), [
		["m-new", 2500, 0.25],
	]);
	assertEquals(detail.members.map((m) => [m.id, m.spendLimitMinor]), [
		["m-owner", null],
		["m-lead", null],
		["m-new", 10_000],
	]);
	assert(detail.viewerCan?.requestSpend && !detail.viewerCan.decide);
});

Deno.test("readDetail (team): no business blocks", async () => {
	const { detail } = await readStubbed(rawTeamDetail(true));
	assert(detail);
	assertEquals([detail.moneyTiles, detail.viewerCan, detail.kyb], [[], null, null]);
});

// #endregion
