/**
 * split-model.test — the Team pay demo against `finance.fn_team_split_plan`
 * (`supabase/migrations/00001200_functions_finance_core.sql:97-169`): the worked figures of
 * `flows/LANDING.md` §5 rows C4 and N2–N5 by the SQL formulas, plans read back from the live
 * function for the seeded teams, every rule branch, conservation to the penny, the product's even
 * split (`mappers.ts` `evenSplit`, `deriveSplitModel`), the fee-unavailable fallbacks (§4) and the
 * frames and rows, verbatim (§4.4).
 */
import { assert, assertEquals } from "@std/assert";
import { PLATFORM_FEE_BP } from "@projective/types/finance";
import { SplitRuleType } from "@projective/types/finance";
import { splitIsBalanced, SplitPreviewLineSchema } from "@projective/types/workspace";
import { deriveSplitModel, evenSplit, projectedShare } from "@server/services/workspace/mappers.ts";
import {
	approvedStageLine,
	customSplitOf,
	evenSplitOf,
	evenStakes,
	rowText,
	sharePercent,
	splitAnnouncement,
	splitModelOf,
	type SplitRule,
	type SplitStakeInput,
	stakesAddUp,
	TEAM_PAY_COPY,
	TEAM_PAY_FIXTURE,
	teamPayFrames,
	teamPayView,
	teamSplitPlan,
} from "./split-model.ts";

const BP = PLATFORM_FEE_BP;
const COOP_10: SplitRule = {
	ruleType: "co_op",
	vaultBp: 1_000,
	finderUserId: null,
	finderBp: null,
};
const stake = (memberId: string, percentBp: number, active = true): SplitStakeInput => ({
	memberId,
	percentBp,
	active,
});

// #region The worked example — §5 C4, N2–N5
Deno.test("plan: N2–N4 — £1,900 to a 10% vault and an even three-way split, the spare penny to the vault", () => {
	// payout 190000; vault = 190000 × 1000 / 10000 = 19000; pool 171000;
	// 171000 × 3334 / 10000 = 57011 (57011.4); 171000 × 3333 / 10000 = 56994 (56994.3); dust 1.
	const plan = teamSplitPlan(190_000, COOP_10, [
		stake("owner", 3_334),
		stake("designer", 3_333),
		stake("developer", 3_333),
	]);
	assertEquals(plan, {
		payoutMinor: 190_000,
		ruleType: "co_op",
		vaultBp: 1_000,
		finderUserId: null,
		finderMinor: 0,
		vaultMinor: 19_000,
		members: [
			{ memberId: "owner", percentBp: 3_334, amountMinor: 57_011 },
			{ memberId: "designer", percentBp: 3_333, amountMinor: 56_994 },
			{ memberId: "developer", percentBp: 3_333, amountMinor: 56_994 },
		],
		dustMinor: 1,
		vaultTotalMinor: 19_001,
	});
});

Deno.test("plan: N5 — custom 50 / 30 / 20 divides the £1,710 pool exactly; the vault is unchanged", () => {
	// 171000 × 5000 / 10000 = 85500; × 3000 = 51300; × 2000 = 34200; dust 0.
	const plan = teamSplitPlan(190_000, COOP_10, [
		stake("owner", 5_000),
		stake("designer", 3_000),
		stake("developer", 2_000),
	]);
	assertEquals(plan.members.map((member) => member.amountMinor), [85_500, 51_300, 34_200]);
	assertEquals([plan.vaultMinor, plan.dustMinor, plan.vaultTotalMinor], [19_000, 0, 19_000]);
});

Deno.test("plan: matches plans read back from the live finance.fn_team_split_plan (seeded teams)", () => {
	// `SELECT finance.fn_team_split_plan(team_id, p)` over the three seeded co_op teams (10% vault) on
	// the local database, 2026-10-19; member ids are the seed's own.
	const teams: Record<string, SplitStakeInput[]> = {
		"213dc9f8": [
			stake("9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d", 5_000),
			stake("0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb", 2_500),
			stake("3fc3da04-549b-4239-aca3-fa82f713dbaf", 2_500),
		],
		"a4c25501": [
			stake("c859a726-490c-4f6d-a184-8984de3994d3", 7_000),
			stake("0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb", 3_000),
		],
		"edc2d943": [
			// Out of order on purpose: the plan sorts by stake, then member id.
			stake("5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd", 3_000),
			stake("c7173d3f-8b15-4876-afbf-499d17513a44", 4_000),
			stake("2e4274fb-e76b-4640-ad31-c66d7fbea842", 3_000),
		],
	};
	const live: Array<[string, number, number[], number, number]> = [
		// team, payout, member amounts (plan order), vault cut, dust
		["213dc9f8", 190_000, [85_500, 42_750, 42_750], 19_000, 0],
		["213dc9f8", 1_999, [900, 450, 450], 199, 0],
		["213dc9f8", 2_017, [908, 454, 454], 201, 0],
		["213dc9f8", 190_007, [85_503, 42_751, 42_751], 19_000, 2],
		["213dc9f8", 1, [0, 0, 0], 0, 1],
		["a4c25501", 190_000, [119_700, 51_300], 19_000, 0],
		["a4c25501", 2_017, [1_271, 544], 201, 1],
		["a4c25501", 190_007, [119_704, 51_302], 19_000, 1],
		["edc2d943", 190_000, [68_400, 51_300, 51_300], 19_000, 0],
		["edc2d943", 2_017, [726, 544, 544], 201, 2],
		["edc2d943", 190_007, [68_402, 51_302, 51_302], 19_000, 1],
	];
	for (const [team, payout, amounts, vault, dust] of live) {
		const plan = teamSplitPlan(payout, COOP_10, teams[team]);
		assertEquals(plan.members.map((member) => member.amountMinor), amounts, `${team} @ ${payout}`);
		assertEquals([plan.vaultMinor, plan.dustMinor, plan.vaultTotalMinor], [
			vault,
			dust,
			vault + dust,
		]);
	}
	assertEquals(
		teamSplitPlan(190_000, COOP_10, teams["edc2d943"]).members.map((member) => member.memberId),
		[
			"c7173d3f-8b15-4876-afbf-499d17513a44",
			"2e4274fb-e76b-4640-ad31-c66d7fbea842",
			"5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd",
		],
	);
});
// #endregion

// #region Every branch of the function
Deno.test("plan: no payout is an empty plan with no rule (00001200:124-127)", () => {
	const empty = {
		payoutMinor: 0,
		ruleType: null,
		vaultBp: 0,
		finderUserId: null,
		finderMinor: 0,
		vaultMinor: 0,
		members: [],
		dustMinor: 0,
		vaultTotalMinor: 0,
	};
	assertEquals(teamSplitPlan(0, COOP_10, [stake("a", 10_000)]), empty);
	assertEquals(teamSplitPlan(-5, COOP_10, [stake("a", 10_000)]), empty);
	assertEquals(teamSplitPlan(null, COOP_10, [stake("a", 10_000)]), empty);
});

Deno.test("plan: benevolent_dictator pays everything into the vault (00001200:133-137)", () => {
	const plan = teamSplitPlan(190_000, {
		ruleType: "benevolent_dictator",
		vaultBp: 1_000,
		finderUserId: null,
		finderBp: null,
	}, [stake("a", 10_000)]);
	assertEquals(plan, {
		payoutMinor: 190_000,
		ruleType: "benevolent_dictator",
		vaultBp: 10_000,
		finderUserId: null,
		finderMinor: 0,
		vaultMinor: 190_000,
		members: [],
		dustMinor: 0,
		vaultTotalMinor: 190_000,
	});
});

Deno.test("plan: finders_fee takes the finder's cut first, then the vault's, then the stakes (00001200:138-143)", () => {
	// finder = 190000 × 1500 / 10000 = 28500; rest 161500; vault = 16150; pool 145350;
	// 145350 × 6000 / 10000 = 87210; × 4000 = 58140; dust 0.
	const plan = teamSplitPlan(190_000, {
		ruleType: "finders_fee",
		vaultBp: 1_000,
		finderUserId: "finder",
		finderBp: 1_500,
	}, [stake("a", 6_000), stake("b", 4_000)]);
	assertEquals(plan.finderMinor, 28_500);
	assertEquals(plan.finderUserId, "finder");
	assertEquals(plan.vaultMinor, 16_150);
	assertEquals(plan.members.map((member) => member.amountMinor), [87_210, 58_140]);
	assertEquals(plan.dustMinor, 0);
});

Deno.test("plan: a finders_fee rule with no finder, or a zero cut, names no finder (00001200:138, :161)", () => {
	const noFinder = teamSplitPlan(190_000, {
		ruleType: "finders_fee",
		vaultBp: 1_000,
		finderUserId: null,
		finderBp: 1_500,
	}, [stake("a", 10_000)]);
	assertEquals([noFinder.finderMinor, noFinder.finderUserId, noFinder.ruleType], [
		0,
		null,
		"finders_fee",
	]);
	const zeroCut = teamSplitPlan(190_000, {
		ruleType: "finders_fee",
		vaultBp: 0,
		finderUserId: "finder",
		finderBp: null,
	}, [stake("a", 10_000)]);
	assertEquals([zeroCut.finderMinor, zeroCut.finderUserId], [0, null]);
});

Deno.test("plan: no rule is co_op with no vault cut (00001200:105, :159-160)", () => {
	const plan = teamSplitPlan(1_000, null, [stake("a", 5_000), stake("b", 5_000)]);
	assertEquals([plan.ruleType, plan.vaultBp, plan.vaultMinor], ["co_op", 0, 0]);
	assertEquals(plan.members.map((member) => member.amountMinor), [500, 500]);
});

Deno.test("plan: inactive members and zero stakes are paid nothing; their share is dust the vault keeps (00001200:148-149)", () => {
	const plan = teamSplitPlan(190_000, COOP_10, [
		stake("a", 5_000),
		stake("b", 3_000, false),
		stake("c", 2_000),
		stake("d", 0),
	]);
	assertEquals(plan.members.map((member) => member.memberId), ["a", "c"]);
	assertEquals(plan.dustMinor, 171_000 - 85_500 - 34_200);
	assertEquals(plan.vaultTotalMinor, 19_000 + 51_300);
});

Deno.test("plan: it always adds up to the payout, to the penny (N4; supabase/probes/team_split_properties.sql)", () => {
	const splits = [[10_000], [5_000, 5_000], [3_334, 3_333, 3_333], [7_001, 2_999], [
		2_500,
		2_500,
		2_500,
		2_500,
	]];
	for (const vaultBp of [0, 1, 1_000, 3_333, 10_000]) {
		for (const bps of splits) {
			for (let payout = 1; payout < 30_000; payout += 197) {
				const plan = teamSplitPlan(
					payout,
					{ ruleType: "co_op", vaultBp, finderUserId: null, finderBp: null },
					bps.map((bp, index) => stake(`m${index}`, bp)),
				);
				const members = plan.members.reduce((sum, member) => sum + member.amountMinor, 0);
				assertEquals(members + plan.finderMinor + plan.vaultTotalMinor, payout);
				assert(plan.dustMinor >= 0 && plan.dustMinor < Math.max(1, bps.length) + 1);
			}
		}
	}
});

Deno.test("plan: each share is the product's projectedShare of the pool", () => {
	const plan = teamSplitPlan(190_007, COOP_10, [
		stake("a", 3_334),
		stake("b", 3_333),
		stake("c", 3_333),
	]);
	const pool = 190_007 - plan.vaultMinor;
	for (const member of plan.members) {
		assertEquals(member.amountMinor, projectedShare(pool, member.percentBp));
	}
});
// #endregion

// #region The even split and the split's reading — the product's own
Deno.test("even split: floor(10000 / n) each, the spare points on the owner — as mappers.ts evenSplit", () => {
	for (
		const ids of [["owner", "b"], ["owner", "b", "c"], ["a", "owner", "c", "d", "e", "f", "g"]]
	) {
		assertEquals(
			evenStakes(ids, "owner").map((s) => ({ memberId: s.memberId, shareBp: s.bp })),
			evenSplit(ids, "owner"),
		);
		assertEquals(
			evenStakes(ids, null).map((s) => ({ memberId: s.memberId, shareBp: s.bp })),
			evenSplit(ids, null),
		);
	}
	assertEquals(evenSplitOf().map((s) => s.bp), [3_334, 3_333, 3_333]);
	assertEquals(customSplitOf().map((s) => s.bp), [5_000, 3_000, 2_000]);
	assert(splitIsBalanced(evenSplitOf().map((s) => ({ shareBp: s.bp }))));
	assert(splitIsBalanced(customSplitOf().map((s) => ({ shareBp: s.bp }))));
});

Deno.test("split model: even within one basis point, custom otherwise — as deriveSplitModel", () => {
	const cases = [[3_334, 3_333, 3_333], [5_000, 3_000, 2_000], [5_000, 5_000], [5_001, 4_999], [
		10_000,
	]];
	for (const bps of cases) {
		const derived = deriveSplitModel(bps.map((shareBp) => ({ shareBp, held: false })));
		assertEquals(splitModelOf(bps.map((bp) => ({ bp }))), derived === "equal" ? "even" : "custom");
	}
	assert(stakesAddUp(evenSplitOf()));
	assert(!stakesAddUp([{ bp: 5_000 }, { bp: 4_000 }]));
});

Deno.test("fixture: a co_op rule the product's own SplitRuleType accepts; preview lines it could show", () => {
	assert(SplitRuleType.safeParse(TEAM_PAY_FIXTURE.rule.ruleType).success);
	const view = teamPayView(evenSplitOf(), BP);
	for (const row of [...view.members, view.vault]) {
		const parsed = SplitPreviewLineSchema.safeParse({
			key: row.key === "vault" ? "vault" : `member:${row.key}`,
			kind: row.key === "vault" ? "vault" : "member",
			name: row.key === "vault" ? null : row.role,
			bp: row.bp,
			amount: { minor: row.amountMinor, currency: "GBP", display: "", origin: null },
		});
		assert(parsed.success, JSON.stringify(parsed.error?.issues));
	}
});
// #endregion

// #region The picture and the copy
Deno.test("view: the £2,000 stage — fee £100, £1,900 split, the vault £190.01 with the spare penny (C4, N2–N4)", () => {
	const view = teamPayView(evenSplitOf(), BP);
	assertEquals([view.feeMinor, view.payoutMinor, view.vaultCutMinor, view.dustMinor], [
		10_000,
		190_000,
		19_000,
		1,
	]);
	assertEquals(view.members.map((row) => rowText(row)), [
		"Owner · 33.34% · £570.11 · clears in 7 days",
		"Designer · 33.33% · £569.94 · clears in 7 days",
		"Developer · 33.33% · £569.94 · clears in 7 days",
	]);
	assertEquals(rowText(view.vault), "Team vault · 10% · £190.01 · clears in 7 days");
	assertEquals(view.model, "even");
	assert(view.whole);
});

Deno.test("view: custom shares change the amounts and leave the vault unchanged (N5)", () => {
	const view = teamPayView(customSplitOf(), BP);
	assertEquals(view.members.map((row) => rowText(row)), [
		"Owner · 50% · £855.00 · clears in 7 days",
		"Designer · 30% · £513.00 · clears in 7 days",
		"Developer · 20% · £342.00 · clears in 7 days",
	]);
	assertEquals(rowText(view.vault), "Team vault · 10% · £190.00 · clears in 7 days");
	assertEquals(view.model, "custom");
});

Deno.test("view: without the fee every amount is hidden, the shares stay (§4)", () => {
	const view = teamPayView(evenSplitOf(), null);
	assertEquals([view.feeMinor, view.payoutMinor, view.plan, view.dustMinor], [
		null,
		null,
		null,
		null,
	]);
	assertEquals(rowText(view.members[0]), "Owner · 33.34% · clears in 7 days");
	assertEquals(rowText(view.vault), "Team vault · 10% · clears in 7 days");
});

Deno.test("copy: shares as the rows write them", () => {
	assertEquals([sharePercent(3_334), sharePercent(5_000), sharePercent(4_250), sharePercent(1)], [
		"33.34%",
		"50%",
		"42.5%",
		"0.01%",
	]);
});

Deno.test("frames: the six frames, verbatim, with the 5% fee (§4.4)", () => {
	assertEquals(teamPayFrames(BP).map((frame) => frame.lines), [
		["A £2,000 stage is approved. The 5% fee leaves £1,900.00."],
		["The team keeps 10% in its shared vault: £190.00."],
		["The rest splits three ways: £570.11, £569.94 and £569.94."],
		["Any spare penny goes to the vault. It all adds up."],
		["Try custom shares: 50%, 30% and 20%. Watch the amounts change."],
		["Each share clears in 7 days. Then members can withdraw it."],
	]);
	assertEquals(teamPayFrames(BP).map((frame) => frame.phase), [
		"approved",
		"vault",
		"shares",
		"dust",
		"custom",
		"clears",
	]);
});

Deno.test("frames: without the fee no amount is said (§4)", () => {
	assertEquals(teamPayFrames(null).map((frame) => frame.lines), [
		["A £2,000 stage is approved."],
		["The team keeps 10% in its shared vault."],
		["The rest splits three ways: 33.34%, 33.33% and 33.33%."],
		["Any spare penny goes to the vault. It all adds up."],
		["Try custom shares: 50%, 30% and 20%."],
		["Each share clears in 7 days. Then members can withdraw it."],
	]);
	assertEquals(approvedStageLine(null), "A £2,000 stage is approved.");
	for (const line of teamPayFrames(null).flatMap((frame) => frame.lines)) {
		assert(!/£\d+\.\d\d/.test(line), line);
	}
});

Deno.test("copy: the fixed lines, verbatim (§4.4), and the live region's summary", () => {
	assertEquals(TEAM_PAY_COPY.vaultLine, "This team keeps 10% in its vault.");
	assertEquals(TEAM_PAY_COPY.validation, "Shares must add up to 100%.");
	assertEquals(
		TEAM_PAY_COPY.comingSoon,
		"Coming soon with Pro Team: a finder's fee, or paying everything into the team vault.",
	);
	assertEquals([TEAM_PAY_COPY.even, TEAM_PAY_COPY.custom], ["Example even split", "Custom split"]);
	assertEquals(
		splitAnnouncement(teamPayView(customSplitOf(), BP)),
		"Owner · 50% · £855.00 · clears in 7 days. Designer · 30% · £513.00 · clears in 7 days. " +
			"Developer · 20% · £342.00 · clears in 7 days. Team vault · 10% · £190.00 · clears in 7 days.",
	);
});

Deno.test("copy: no banned word, and no lead-heavy template or tax pot (§4, §6 V5)", () => {
	const banned = /\b(escrow|release|squad|lead-heavy|tax pot|instant payout|until you approve)\b/i;
	const text = [
		...teamPayFrames(BP).flatMap((frame) => frame.lines),
		...teamPayFrames(null).flatMap((frame) => frame.lines),
		...Object.values(TEAM_PAY_COPY),
	];
	for (const line of text) assert(!banned.test(line), line);
});
// #endregion
