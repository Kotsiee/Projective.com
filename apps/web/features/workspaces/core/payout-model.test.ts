import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import {
	splitDriftBp,
	type SplitStake,
	type TeamSplitRule,
	type VaultAccess,
} from "@projective/types/workspace";
import { handleValueText, keyToSplit, SPLIT_TOTAL_BP } from "@ui/fields/core/split-bar-model.ts";
import { type RawSplitPreview, toSplitPreview } from "@server/services/workspace/live-money.ts";
import {
	blockNotice,
	bpToPercent,
	canRestoreWhole,
	defaultPreviewMinor,
	draftFrom,
	driftSentence,
	evenStakes,
	formatBp,
	isEvenSplit,
	ledgerRows,
	legendItems,
	lockedNotice,
	offersRebalance,
	payoutDirty,
	type PayoutDraft,
	payoutEditable,
	type PayoutSaved,
	payoutSections,
	percentToBp,
	refusalMayHaveSaved,
	refusalNotice,
	restoreWhole,
	ruleChanged,
	ruleFields,
	ruleInputOf,
	ruleProblems,
	saveBlock,
	saveBody,
	segmentsOf,
	selectTemplate,
	stakesChanged,
	stakesMode,
	TEMPLATE_SENTENCE,
	templateChoices,
	vaultAccessItems,
	withHeld,
	withSegments,
} from "./payout-model.ts";
import { rigFilledCount, type RigInput, rigModel } from "./rig-model.ts";

/**
 * The team Payouts module (Teams work order C4) as pure rules: the one bp ⇄ % conversion, the
 * templates and their plan locks, the draft, what a Save sends and what a refused one re-reads, drift
 * and the even split, the SplitBar's keyboard over the stakes, the Preview ledger's total against the
 * amount typed (raw `preview_team_split` payloads through the backend mapper), the vault readout, and
 * the page's filled controls — read off the components' own source — with the footer rig.
 */

// #region Fixtures
function stake(memberId: string, shareBp: number, held = false): SplitStake {
	return {
		memberId,
		userId: `u-${memberId}`,
		handle: memberId,
		name: memberId[0].toUpperCase() + memberId.slice(1),
		avatar: "",
		shareBp,
		held,
		projected: { minor: 0, currency: "GBP", display: "£0.00", origin: null },
	};
}

const CO_OP: TeamSplitRule = {
	ruleType: "co_op",
	vaultBp: 1000,
	finderUserId: null,
	finderBp: null,
};
const FINDERS: TeamSplitRule = {
	ruleType: "finders_fee",
	vaultBp: 500,
	finderUserId: "u-ben",
	finderBp: 1000,
};
const DICTATOR: TeamSplitRule = {
	ruleType: "benevolent_dictator",
	vaultBp: 10_000,
	finderUserId: null,
	finderBp: null,
};
const STAKES = [stake("ana", 5000), stake("ben", 3000), stake("cy", 2000)];
const SAVED: PayoutSaved = { rule: CO_OP, stakes: STAKES };
const ALL = ["co_op", "finders_fee", "benevolent_dictator"] as const;

/** A deterministic PRNG (mulberry32), so a failing random case can be replayed. */
function prng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
	};
}
// #endregion

// #region bp ⇄ %
Deno.test("percentToBp ⇄ bpToPercent: every basis point round-trips exactly", () => {
	for (let bp = 0; bp <= SPLIT_TOTAL_BP; bp++) {
		assertStrictEquals(percentToBp(bpToPercent(bp)), bp, `bp ${bp}`);
	}
});

Deno.test("formatBp: two decimals, always", () => {
	assertEquals(formatBp(0), "0.00%");
	assertEquals(formatBp(1), "0.01%");
	assertEquals(formatBp(4250), "42.50%");
	assertEquals(formatBp(3333), "33.33%");
	assertEquals(formatBp(10_000), "100.00%");
});

Deno.test("percentToBp: stores integers — rounded on the decimal, clamped to 0–100%", () => {
	assertStrictEquals(percentToBp(12.345), 1235);
	assertStrictEquals(percentToBp(0.29), 29);
	assertStrictEquals(percentToBp(33.333), 3333);
	assertStrictEquals(percentToBp(-5), 0);
	assertStrictEquals(percentToBp(250), 10_000);
	assertStrictEquals(percentToBp(null), 0);
	assertStrictEquals(percentToBp(Number.NaN), 0);
	for (const typed of [0.01, 1.5, 7.25, 12.5, 99.99]) {
		assert(Number.isInteger(percentToBp(typed)), `${typed}`);
	}
});
// #endregion

// #region Templates and plan locks
Deno.test("templateChoices: a locked template is disabled — unless it is the saved one", () => {
	const free = templateChoices(["co_op"], "co_op");
	assertEquals(free.map((c) => [c.value, c.locked, c.disabled]), [
		["co_op", false, false],
		["finders_fee", true, true],
		["benevolent_dictator", true, true],
	]);
	const downgraded = templateChoices(["co_op"], "finders_fee");
	assertEquals(downgraded.map((c) => c.disabled), [false, false, true]);
	assert(templateChoices([...ALL], "co_op").every((c) => !c.locked && !c.disabled));
});

Deno.test("lockedNotice: names the locked templates, or the saved one the plan no longer covers", () => {
	assertEquals(lockedNotice([...ALL], "co_op"), null);
	assertEquals(
		lockedNotice(["co_op"], "co_op"),
		"Finder's fee and Benevolent dictator are part of Pro Team.",
	);
	assertEquals(
		lockedNotice(["co_op", "finders_fee"], "co_op"),
		"Benevolent dictator is part of Pro Team.",
	);
	assertEquals(
		lockedNotice(["co_op"], "finders_fee"),
		"This team still pays out by Finder's fee, but changing it needs Pro Team.",
	);
});

Deno.test("ruleFields and the template sentences", () => {
	assertEquals(ruleFields("co_op"), { vault: true, finder: false });
	assertEquals(ruleFields("finders_fee"), { vault: true, finder: true });
	assertEquals(ruleFields("benevolent_dictator"), { vault: false, finder: false });
	for (const type of ALL) assert(TEMPLATE_SENTENCE[type].endsWith("."));
	assert(TEMPLATE_SENTENCE.benevolent_dictator.includes("Team Vault"));
});
// #endregion

// #region Zones
Deno.test("payoutSections: four zones; Member stakes gives way under benevolent_dictator", () => {
	assertEquals(payoutSections("co_op"), ["rule", "stakes", "preview", "access"]);
	assertEquals(payoutSections("finders_fee"), ["rule", "stakes", "preview", "access"]);
	assertEquals(payoutSections("benevolent_dictator"), ["rule", "preview", "access"]);
	assertEquals(stakesMode("benevolent_dictator"), "vault");
	assertEquals(stakesMode("co_op"), "split");
});

Deno.test("payoutEditable: manage_finances on a team that is not archived", () => {
	assert(payoutEditable(true, "active"));
	assert(payoutEditable(true, "draft"));
	assert(!payoutEditable(true, "archived"));
	assert(!payoutEditable(false, "active"));
});
// #endregion

// #region The draft and the save
Deno.test("draftFrom: the saved rule's cuts; benevolent_dictator opens with no vault cut to carry", () => {
	assertEquals(draftFrom(SAVED), {
		ruleType: "co_op",
		vaultBp: 1000,
		finderUserId: null,
		finderBp: null,
		stakes: STAKES,
	});
	assertEquals(draftFrom({ rule: FINDERS, stakes: STAKES }).finderBp, 1000);
	assertEquals(draftFrom({ rule: DICTATOR, stakes: STAKES }).vaultBp, 0);
});

Deno.test("a clean draft is not dirty and sends nothing", () => {
	const draft = draftFrom(SAVED);
	assert(!payoutDirty(draft, SAVED));
	assertEquals(saveBody("t1", draft, SAVED), null);
	assertEquals(saveBlock(draft, SAVED, [...ALL]), null);
});

Deno.test("saveBody: one request — only the changed rule, only the changed stakes", () => {
	const draft = draftFrom(SAVED);
	const cut: PayoutDraft = { ...draft, vaultBp: 1500 };
	assertEquals(saveBody("t1", cut, SAVED), {
		workspaceId: "t1",
		rule: { ruleType: "co_op", vaultBp: 1500 },
	});

	const moved = withSegments(draft.stakes, [
		{ key: "ana", label: "Ana", bp: 4000 },
		{ key: "ben", label: "Ben", bp: 4000 },
		{ key: "cy", label: "Cy", bp: 2000 },
	]);
	assertEquals(saveBody("t1", { ...draft, stakes: moved }, SAVED), {
		workspaceId: "t1",
		stakes: [
			{ memberId: "ana", shareBp: 4000, held: false },
			{ memberId: "ben", shareBp: 4000, held: false },
			{ memberId: "cy", shareBp: 2000, held: false },
		],
	});

	const both = saveBody("t1", { ...cut, stakes: moved }, SAVED);
	assertEquals(Object.keys(both ?? {}).sort(), ["rule", "stakes", "workspaceId"]);
});

Deno.test("saveBody: a finder's fee carries its finder; benevolent_dictator sends no stakes", () => {
	const draft: PayoutDraft = {
		...draftFrom(SAVED),
		ruleType: "finders_fee",
		finderUserId: "u-ben",
		finderBp: 1200,
	};
	assertEquals(saveBody("t1", draft, SAVED)?.rule, {
		ruleType: "finders_fee",
		vaultBp: 1000,
		finderUserId: "u-ben",
		finderBp: 1200,
	});

	const hidden: PayoutDraft = {
		...draftFrom(SAVED),
		ruleType: "benevolent_dictator",
		stakes: withHeld(STAKES, "ana", true),
	};
	assertEquals(saveBody("t1", hidden, SAVED), {
		workspaceId: "t1",
		rule: { ruleType: "benevolent_dictator" },
	});
	// A stake moved and then hidden is not a change the reader can see.
	assert(!payoutDirty({ ...hidden, ruleType: "co_op", stakes: STAKES }, SAVED));
});

Deno.test("ruleChanged: only the parameters the template uses count", () => {
	const saved = FINDERS;
	const draft = draftFrom({ rule: saved, stakes: STAKES });
	assert(!ruleChanged(draft, saved));
	assert(ruleChanged({ ...draft, finderBp: 900 }, saved));
	assert(ruleChanged({ ...draft, finderUserId: "u-cy" }, saved));
	assert(ruleChanged({ ...draft, vaultBp: 0 }, saved));
	const dictator = draftFrom({ rule: DICTATOR, stakes: STAKES });
	assert(!ruleChanged({ ...dictator, vaultBp: 2500 }, DICTATOR));
});

Deno.test("ruleProblems: a finder and a cut of at least 1 bp that fits beside the vault's", () => {
	const draft: PayoutDraft = { ...draftFrom(SAVED), ruleType: "finders_fee" };
	assertEquals(Object.keys(ruleProblems(draft)).sort(), ["finder", "finderCut"]);
	assertEquals(ruleInputOf(draft), null);
	assertEquals(
		ruleProblems({ ...draft, finderUserId: "u-ana", finderBp: 0 }).finderCut,
		"Give the finder a cut of at least 0.01%.",
	);
	assertEquals(
		ruleProblems({ ...draft, finderUserId: "u-ana", finderBp: 9001, vaultBp: 1000 }).finderCut,
		"The finder's and the Vault's cuts together can't pass 100%.",
	);
	assertEquals(
		ruleProblems({ ...draft, finderUserId: "u-ana", finderBp: 9000, vaultBp: 1000 }),
		{},
	);
	assertEquals(ruleProblems(draftFrom(SAVED)), {});
});

Deno.test("saveBlock: a locked template, a rule problem, then drift — each before any request", () => {
	const base = draftFrom(SAVED);
	assertEquals(saveBlock({ ...base, ruleType: "finders_fee" }, SAVED, ["co_op"]), {
		reason: "locked",
		ruleType: "finders_fee",
	});
	assertEquals(saveBlock({ ...base, ruleType: "finders_fee" }, SAVED, [...ALL])?.reason, "rule");
	const short = [stake("ana", 5000), stake("ben", 3000), stake("cy", 1000)];
	assertEquals(saveBlock({ ...base, stakes: short }, SAVED, [...ALL]), {
		reason: "drift",
		driftBp: -1000,
		restorable: true,
	});
	const allHeld = short.map((s) => ({ ...s, held: true }));
	assertEquals(saveBlock({ ...base, stakes: allHeld }, SAVED, [...ALL]), {
		reason: "drift",
		driftBp: -1000,
		restorable: false,
	});
	assertEquals(blockNotice({ reason: "locked", ruleType: "benevolent_dictator" }), {
		text: "Benevolent dictator is part of Pro Team.",
		plans: true,
	});
	assert(!blockNotice({ reason: "drift", driftBp: -10, restorable: true }).plans);
	assert(
		blockNotice({ reason: "drift", driftBp: -10, restorable: false }).text.startsWith(
			"Release a held stake",
		),
	);
});

Deno.test("a refused Save that carried the rule and the stakes re-reads, and the saved rule stops reading as unsaved", () => {
	const moved = [stake("ana", 4000), stake("ben", 4000), stake("cy", 2000)];
	const draft: PayoutDraft = { ...draftFrom(SAVED), vaultBp: 1500, stakes: moved };
	const body = saveBody("t1", draft, SAVED)!;
	assert(refusalMayHaveSaved(body), "a rule written before refused stakes may have landed");
	assert(!refusalMayHaveSaved({ workspaceId: "t1", rule: body.rule }), "a lone rule saved nothing");
	assert(
		!refusalMayHaveSaved({ workspaceId: "t1", stakes: body.stakes }),
		"lone stakes saved nothing",
	);

	// The rule saved, the stakes refused: the re-read detail carries the new rule beside the old stakes.
	const reread: PayoutSaved = { rule: { ...CO_OP, vaultBp: 1500 }, stakes: STAKES };
	assert(!ruleChanged(draft, reread.rule), "the stored rule is no longer a change");
	assert(payoutDirty(draft, reread), "the refused stakes still are");
	assertEquals(saveBody("t1", draft, reread), {
		workspaceId: "t1",
		stakes: moved.map((s) => ({ memberId: s.memberId, shareBp: s.shareBp, held: false })),
	});
});

Deno.test("selectTemplate: returning to a saved template the plan no longer unlocks restores its cuts", () => {
	const saved: PayoutSaved = { rule: FINDERS, stakes: STAKES };
	const away = selectTemplate(draftFrom(saved), "co_op", saved, ["co_op"]);
	const edited: PayoutDraft = { ...away, vaultBp: 2500 };
	const back = selectTemplate(edited, "finders_fee", saved, ["co_op"]);
	assertEquals([back.ruleType, back.vaultBp, back.finderBp], ["finders_fee", 500, 1000]);
	assert(!ruleChanged(back, FINDERS));
	// An unlocked template simply switches, keeping the draft's cuts.
	assertEquals(selectTemplate(edited, "finders_fee", saved, [...ALL]).vaultBp, 2500);
});

Deno.test("refusalNotice: the plan gate offers the plans; anything else is the database's sentence", () => {
	assertEquals(
		refusalNotice(
			{
				message: "entitlement",
				details: { reason: "entitlement", entitlement: "split_template_finders_fee" },
			},
			"finders_fee",
			"North Loop",
		),
		{ text: "Finder's fee is part of Pro Team, which North Loop isn't on.", plans: true },
	);
	assertEquals(
		refusalNotice({ message: "x", errors: { stakes: "The split must total 100%." } }, "co_op", "T"),
		{ text: "The split must total 100%.", plans: false },
	);
	assertEquals(refusalNotice({}, "co_op", "T").plans, false);
});
// #endregion

// #region Stakes, drift and the even split
Deno.test("restoreWhole: back to exactly 100%, held stakes untouched, the remainder on the largest", () => {
	const rand = prng(7);
	for (let round = 0; round < 200; round++) {
		const n = 2 + Math.floor(rand() * 7);
		const stakes = Array.from(
			{ length: n },
			(_, i) => stake(`m${i}`, Math.floor(rand() * 3000), rand() < 0.2),
		);
		const held = stakes.reduce((sum, s) => sum + (s.held ? s.shareBp : 0), 0);
		const restored = restoreWhole(stakes);
		const blocked = held > SPLIT_TOTAL_BP || stakes.every((s) => s.held);
		assertStrictEquals(canRestoreWhole(stakes), !blocked, `round ${round}`);
		if (blocked) {
			assertEquals(restored, stakes);
			continue;
		}
		assertStrictEquals(splitDriftBp(restored), 0, `round ${round}`);
		restored.forEach((s, i) => {
			assert(Number.isInteger(s.shareBp) && s.shareBp >= 0);
			if (stakes[i].held) assertStrictEquals(s.shareBp, stakes[i].shareBp);
		});
	}
	assertEquals(
		restoreWhole([stake("a", 0), stake("b", 0), stake("c", 0)]).map((s) => s.shareBp),
		[3334, 3333, 3333],
	);
	assertEquals(
		restoreWhole([stake("a", 4000), stake("b", 2000), stake("c", 3000, true)]).map((s) =>
			s.shareBp
		),
		[4667, 2333, 3000],
	);
});

Deno.test("evenStakes: equal unheld stakes, the remainder on the owner", () => {
	const even = evenStakes(STAKES, "ben");
	assertEquals(even.map((s) => s.shareBp), [3333, 3334, 3333]);
	assert(isEvenSplit(even, "ben"));
	assert(!isEvenSplit(STAKES, "ben"));
	const held = evenStakes(withHeld(STAKES, "ana", true), null);
	assertEquals(held.map((s) => s.shareBp), [5000, 2500, 2500]);
});

Deno.test("the drift notice offers Rebalance only when it would change the split", () => {
	const short = [stake("ana", 5000), stake("ben", 3000), stake("cy", 1000)];
	assert(offersRebalance(short, true));
	assert(!offersRebalance(short, false), "a reader who may not edit gets no action");
	assert(!offersRebalance(STAKES, true), "a whole split has nothing to rebalance");
	// Every stake held: restoreWhole cannot move one, so the action would do nothing.
	const allHeld = short.map((s) => ({ ...s, held: true }));
	assert(!canRestoreWhole(allHeld));
	assert(!offersRebalance(allHeld, true));
	assertEquals(restoreWhole(allHeld), allHeld);
	// The held stakes alone pass 100%: only releasing one can fix it.
	const over = [stake("ana", 7000, true), stake("ben", 4000, true), stake("cy", 500)];
	assert(!offersRebalance(over, true));
	assertEquals(restoreWhole(over), over);
	// Whenever the action is offered, pressing it lands on exactly 100%.
	assert(offersRebalance(withHeld(short, "ana", true), true));
	assertStrictEquals(splitDriftBp(restoreWhole(withHeld(short, "ana", true))), 0);
	assert(
		driftSentence(-1000, false).endsWith(
			"Release a held stake, then rebalance them before you save.",
		),
	);
	assert(driftSentence(-1000).endsWith(" Rebalance them before you save."));
});

Deno.test("driftSentence and the legend's tabular facts", () => {
	assert(driftSentence(-1250).startsWith("The stakes add up to 87.50%, not 100%"));
	assert(driftSentence(300).startsWith("The stakes add up to 103.00%"));
	assertEquals(legendItems(withHeld(STAKES, "cy", true)), [
		{ text: "Ana 50.00%", tabular: true },
		{ text: "Ben 30.00%", tabular: true },
		{ text: "Cy 20.00% held", tabular: true },
	]);
	assert(stakesChanged(withHeld(STAKES, "cy", true), STAKES));
	assert(!stakesChanged(withHeld(STAKES, "cy", false), STAKES));
});

Deno.test("SplitBar keyboard over the stakes: arrows 1%, Shift 0.1%, PageUp 10%, value text announced", () => {
	const segments = segmentsOf(STAKES);
	const right = keyToSplit(segments, 0, { key: "ArrowRight" })!;
	assertEquals(right.map((s) => s.bp), [5100, 2900, 2000]);
	assertEquals(handleValueText(right, 0), "Ana 51.00% · Ben 29.00%");
	const left = keyToSplit(segments, 0, { key: "ArrowLeft" })!;
	assertEquals(left.map((s) => s.bp), [4900, 3100, 2000]);
	const fine = keyToSplit(segments, 1, { key: "ArrowUp", shiftKey: true })!;
	assertEquals(fine.map((s) => s.bp), [5000, 3010, 1990]);
	const page = keyToSplit(segments, 0, { key: "PageUp" })!;
	assertEquals(page.map((s) => s.bp), [6000, 2000, 2000]);
	assertEquals(handleValueText(page, 0), "Ana 60.00% · Ben 20.00%");
	const pageDown = keyToSplit(segments, 0, { key: "PageDown" })!;
	assertEquals(pageDown.map((s) => s.bp), [4000, 4000, 2000]);
	// Right-to-left reading reverses the horizontal arrows.
	assertEquals(keyToSplit(segments, 0, { key: "ArrowRight", rtl: true })!.map((s) => s.bp), [
		4900,
		3100,
		2000,
	]);
	// A held neighbour locks the handle.
	const locked = segmentsOf(withHeld(STAKES, "ben", true));
	assertStrictEquals(keyToSplit(locked, 0, { key: "ArrowRight" }), locked);
	// And the change maps back onto the stakes by member id, totalling 100%.
	assertStrictEquals(splitDriftBp(withSegments(STAKES, page)), 0);
	assertEquals(withSegments(STAKES, page).map((s) => s.shareBp), [6000, 2000, 2000]);
});
// #endregion

// #region Preview
/** The people the preview names, as the party-card batch answers them. */
const PREVIEW_PEOPLE: Parameters<typeof toSplitPreview>[1] = new Map([
	["u-ben", { username: "ben", name: "Ben", avatar: null }],
	["u-0", { username: "m0", name: "M0", avatar: null }],
	["u-1", { username: "m1", name: "M1", avatar: null }],
]);

/**
 * A raw `finance.preview_team_split(team, gross)` answer, computed the way the SQL computes it: the
 * platform fee truncated at `fee_bp`, then `finance.fn_team_split_plan` — the finder's floor, the
 * vault's floor of the rest, each stake's floor of the pool, and the dust the floors left. It goes
 * through the backend mapper (`toSplitPreview`) and then `ledgerRows`, so a line either one drops
 * breaks the total.
 */
function rawPreview(
	gross: number,
	feeBp: number,
	rule: TeamSplitRule,
	stakes: readonly number[],
): RawSplitPreview {
	const fee = Math.floor((gross * feeBp) / 10_000);
	const payout = Math.max(gross - fee, 0);
	const base = {
		escrow_id: null,
		gross_minor: gross,
		currency: null,
		fee_minor: fee,
		fee_bp: feeBp,
	};
	if (rule.ruleType === "benevolent_dictator") {
		return {
			...base,
			finder_bp: null,
			plan: {
				payout_minor: payout,
				rule_type: rule.ruleType,
				vault_bp: 10_000,
				finder_user_id: null,
				finder_minor: 0,
				vault_minor: payout,
				members: [],
				dust_minor: 0,
				vault_total_minor: payout,
			},
		};
	}
	const finder = rule.ruleType === "finders_fee"
		? Math.floor((payout * (rule.finderBp ?? 0)) / 10_000)
		: 0;
	const rest = payout - finder;
	const vault = Math.floor((rest * rule.vaultBp) / 10_000);
	const pool = rest - vault;
	let paid = 0;
	const members = stakes.map((bp, i) => {
		const amount = Math.floor((pool * bp) / 10_000);
		paid += amount;
		return { member_user_id: `u-${i}`, percent_bp: bp, amount_minor: amount };
	});
	return {
		...base,
		finder_bp: rule.ruleType === "finders_fee" ? rule.finderBp : null,
		plan: {
			payout_minor: payout,
			rule_type: rule.ruleType,
			vault_bp: rule.vaultBp,
			finder_user_id: rule.ruleType === "finders_fee" ? rule.finderUserId : null,
			finder_minor: finder,
			vault_minor: vault,
			members,
			dust_minor: pool - paid,
			vault_total_minor: vault + pool - paid,
		},
	};
}

Deno.test("ledgerRows: the total row equals the amount priced — 50 random amounts, every template", () => {
	const rand = prng(20261018);
	for (let round = 0; round < 50; round++) {
		const gross = 1 + Math.floor(rand() * 100_000_000_000);
		const n = 1 + Math.floor(rand() * 8);
		const raw = Array.from({ length: n }, () => 1 + Math.floor(rand() * 1000));
		const sum = raw.reduce((a, b) => a + b, 0);
		const stakes = raw.map((w) => Math.floor((w * SPLIT_TOTAL_BP) / sum));
		stakes[0] += SPLIT_TOTAL_BP - stakes.reduce((a, b) => a + b, 0);
		const vaultBp = Math.floor(rand() * 3000);
		const rule: TeamSplitRule = [
			{ ...CO_OP, vaultBp },
			{ ...FINDERS, vaultBp, finderBp: 1 + Math.floor(rand() * 2000) },
			DICTATOR,
		][round % 3];
		const preview = toSplitPreview(rawPreview(gross, 500, rule, stakes), PREVIEW_PEOPLE, "GBP");
		const rows = ledgerRows(preview);
		const total = rows.at(-1)!;
		assertEquals(total.kind, "total");
		assertStrictEquals(total.amount.minor, gross, `round ${round}: ${gross}`);
		assertStrictEquals(
			rows.slice(0, -1).reduce((acc, row) => acc + row.amount.minor, 0),
			gross,
			`round ${round}: the rows sum to the amount`,
		);
		// One row per cut the plan makes: fee, finder (finders_fee), vault, each stake, dust (not under
		// benevolent_dictator), then the total.
		const expected = rule.ruleType === "benevolent_dictator"
			? 3
			: 1 + (rule.ruleType === "finders_fee" ? 1 : 0) + 1 + n + 1 + 1;
		assertStrictEquals(rows.length, expected, `round ${round}: every cut is a row`);
	}
});

Deno.test("ledgerRows: the plan's order and words — fee, finder, vault, members, dust, total", () => {
	const preview = toSplitPreview(
		rawPreview(100_000, 500, FINDERS, [6000, 4000]),
		PREVIEW_PEOPLE,
		"GBP",
	);
	const rows = ledgerRows(preview);
	assertEquals(rows.map((r) => r.label), [
		"Platform fee",
		"Finder · Ben",
		"Vault cut",
		"M0",
		"M1",
		"Vault dust",
		"Total",
	]);
	assertEquals(rows.map((r) => r.rate), [
		"5.00%",
		"10.00%",
		"5.00%",
		"60.00%",
		"40.00%",
		null,
		null,
	]);
	assertEquals(
		ledgerRows(toSplitPreview(rawPreview(100_000, 500, DICTATOR, []), PREVIEW_PEOPLE, "GBP"))
			.map((r) => r.kind),
		["fee", "vault", "total"],
	);
});

Deno.test("defaultPreviewMinor: 1,000 in the currency's own minor units", () => {
	assertStrictEquals(defaultPreviewMinor("GBP"), 100_000);
	assertStrictEquals(defaultPreviewMinor("USD"), 100_000);
	assertStrictEquals(defaultPreviewMinor("JPY"), 1_000);
});
// #endregion

// #region Who can move money
Deno.test("vaultAccessItems: the projection in words, or plainly none", () => {
	const owner: VaultAccess = {
		memberId: "ana",
		name: "Ana",
		capabilities: ["view", "distribute", "withdraw", "manage_members", "manage_billing"],
	};
	assertEquals(vaultAccessItems(owner), [
		"view",
		"distribute",
		"withdraw",
		"manage members",
		"manage billing",
	]);
	assertEquals(vaultAccessItems({ memberId: "x", name: "X", capabilities: [] }), ["no access"]);
});
// #endregion

// #region One filled control
/*
 * The body's controls are read off the components' own source — the island and every workspace
 * component it reaches — rather than a list kept beside them. (They cannot be rendered under
 * `deno test`: every `@projective/ui` component imports its stylesheet, which Deno refuses to load.)
 * A ui Button is filled unless it names the `text`, `link` or `outlined` variant; a pressed
 * ToggleButton is a `--primary` fill; an anchor drawn as a Button is filled unless it wears the
 * outlined class.
 */
const COMPONENTS_DIR = new URL("../components/", import.meta.url);
const PAGE_ISLAND = new URL("../islands/PayoutPolicyScreen.island.tsx", import.meta.url);

/** The page's sources: the island, then every workspace component reached by a relative import. */
function pageSources(): Map<string, string> {
	const out = new Map<string, string>();
	const visit = (url: URL): void => {
		if (out.has(url.href)) return;
		const src = Deno.readTextFileSync(url);
		out.set(url.href, src);
		for (const m of src.matchAll(/from\s+"(\.{1,2}\/[^"]+\.tsx)"/g)) {
			const next = new URL(m[1], url);
			if (next.href.startsWith(COMPONENTS_DIR.href)) visit(next);
		}
	};
	visit(PAGE_ISLAND);
	return out;
}

/** Every JSX opening tag `<name …>` in a source, whole — braces, strings and arrows inside skipped. */
function openingTags(src: string, name: string): string[] {
	const tags: string[] = [];
	for (const m of src.matchAll(new RegExp(`<${name}(?=[\\s/>])`, "g"))) {
		let depth = 0;
		let quote: string | null = null;
		let i = m.index + m[0].length;
		for (; i < src.length; i++) {
			const ch = src[i];
			if (quote) {
				if (ch === quote) quote = null;
			} else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
			else if (ch === "{") depth++;
			else if (ch === "}") depth--;
			else if (ch === ">" && depth === 0) break;
		}
		tags.push(src.slice(m.index, i + 1));
	}
	return tags;
}

/** Whether a `<Button …>` tag draws a filled button (its variant is not text, link or outlined). */
function filledButton(tag: string): boolean {
	return !/\svariant="(text|link|outlined)"/.test(tag);
}

/** Whether an `<a …>` tag is an anchor drawn as a filled Button. */
function filledAnchor(tag: string): boolean {
	return /ui-button\b/.test(tag) && !/ui-button--(outlined|text|link)\b/.test(tag);
}

/** The filled controls the page body draws, by file. */
function bodyFills(sources: Map<string, string>): string[] {
	return [...sources].flatMap(([href, src]) => {
		const file = href.slice(href.lastIndexOf("/") + 1);
		return [
			...openingTags(src, "Button").filter(filledButton).map((tag) => `${file}: ${tag}`),
			...openingTags(src, "ToggleButton").map((tag) => `${file}: ${tag}`),
			...openingTags(src, "a").filter(filledAnchor).map((tag) => `${file}: ${tag}`),
		];
	});
}

function rigFor(dirty: boolean): RigInput {
	return {
		kind: "team",
		handle: "north-loop",
		module: "payouts",
		view: null,
		canCreate: false,
		canInvite: true,
		canManageMoney: true,
		canManageSettings: true,
		dirty,
		saveState: "idle",
	};
}

Deno.test("the page body's source: every section, and not one filled control in it", () => {
	const sources = pageSources();
	const files = [...sources.keys()].map((href) => href.slice(href.lastIndexOf("/") + 1));
	for (
		const file of [
			"PayoutRuleSection.tsx",
			"MemberStakesSection.tsx",
			"SplitLegend.tsx",
			"PayoutPreview.tsx",
			"VaultAccessList.tsx",
		]
	) {
		assert(files.includes(file), `the island reaches ${file}`);
	}
	assertEquals(bodyFills(sources), [], "a filled control in the Payouts body");
	const all = [...sources.values()].join("\n");
	assert(!/severity="accent"/.test(all), "no amber tier-1 control on the page");

	// The hold toggles are the unfilled two-state toggle: a text Button carrying aria-pressed.
	const legend = [...sources].find(([href]) => href.endsWith("/SplitLegend.tsx"))![1];
	const holds = openingTags(legend, "Button").filter((tag) => tag.includes("aria-pressed"));
	assertStrictEquals(holds.length, 1, "one hold toggle, rendered per stake");
	assert(/\svariant="text"/.test(holds[0]), "the hold toggle is a text Button");

	// "See plans" is tier 4: an anchor wearing the neutral outlined Button classes.
	const rule = [...sources].find(([href]) => href.endsWith("/PayoutRuleSection.tsx"))![1];
	const plans = openingTags(rule, "a").filter((tag) => tag.includes("PLAN_HREF"));
	assertStrictEquals(plans.length, 1);
	assert(/ui-button ui-button--neutral ui-button--outlined ui-button--size-sm/.test(plans[0]));
});

Deno.test("the scanner catches a filled control the body might add", () => {
	const fake = new Map([
		["x/A.tsx", `<Button label="Go" onClick={() => go(a > b)} />`],
		["x/B.tsx", `<ToggleButton value={v} />`],
		["x/C.tsx", `<a class="ui-button ui-button--primary ui-button--filled" href="/x">Go</a>`],
		["x/D.tsx", `<Button variant="text" label="Fine" /><a class="wsp-x" href="/y">fine</a>`],
	]);
	assertEquals(bodyFills(fake).map((hit) => hit.split(":")[0]), ["A.tsx", "B.tsx", "C.tsx"]);
});

Deno.test("with the rig, the page draws exactly one filled control — tier-3 Save, only when dirty", () => {
	const body = bodyFills(pageSources()).length;
	for (const dirty of [true, false]) {
		const rig = rigModel(rigFor(dirty));
		assertStrictEquals(body + rigFilledCount(rig), dirty ? 1 : 0);
		const save = rig.actions.find((a) => a.key === "save");
		assertEquals(save ? save.control === "button" && save.tier : null, dirty ? 3 : null);
		const tiers: number[] = rig.actions.flatMap((a) => a.control === "button" ? [a.tier] : []);
		assert(!tiers.includes(1), "no amber tier-1 control");
	}
});
// #endregion
