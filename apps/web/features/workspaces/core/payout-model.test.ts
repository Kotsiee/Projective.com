import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import type { MoneyView } from "@projective/types/finance";
import type {
	SplitStake,
	TeamSplitPreview,
	TeamSplitRule,
	VaultAccess,
} from "@projective/types/workspace";
import { handleValueText, keyToSplit, SPLIT_TOTAL_BP } from "@ui/fields/core/split-bar-model.ts";
import {
	blockNotice,
	bodyControls,
	bpToPercent,
	defaultPreviewMinor,
	draftFrom,
	driftBp,
	driftSentence,
	evenStakes,
	filledButtons,
	formatBp,
	isEvenSplit,
	ledgerRows,
	legendItems,
	lockedNotice,
	payoutDirty,
	type PayoutDraft,
	payoutEditable,
	type PayoutSaved,
	payoutSections,
	percentToBp,
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
 * templates and their plan locks, the draft and what a Save sends, drift and the even split, the
 * SplitBar's keyboard over the stakes, the Preview ledger's total against the amount typed, the
 * vault readout, and the page's filled-control count with the footer rig.
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

function money(minor: number, currency = "GBP"): MoneyView {
	return { minor, currency, display: `£${(minor / 100).toFixed(2)}`, origin: null };
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
	});
	assertEquals(blockNotice({ reason: "locked", ruleType: "benevolent_dictator" }), {
		text: "Benevolent dictator is part of Pro Team.",
		plans: true,
	});
	assert(!blockNotice({ reason: "drift", driftBp: -10 }).plans);
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
		if (held > SPLIT_TOTAL_BP || stakes.every((s) => s.held)) {
			assertEquals(restored, stakes);
			continue;
		}
		assertStrictEquals(driftBp(restored), 0, `round ${round}`);
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
	assertStrictEquals(driftBp(withSegments(STAKES, page)), 0);
	assertEquals(withSegments(STAKES, page).map((s) => s.shareBp), [6000, 2000, 2000]);
});
// #endregion

// #region Preview
/**
 * A preview payload exactly as `finance.preview_team_split(team, gross)` + the backend mapper would
 * answer it: the platform fee truncated, then the plan's floors — finder, vault, each stake — with the
 * dust as its own line, and the total as the lines' sum.
 */
function mockPreview(
	gross: number,
	feeBp: number,
	rule: TeamSplitRule,
	stakes: readonly number[],
): TeamSplitPreview {
	const fee = Math.floor((gross * feeBp) / 10_000);
	const payout = Math.max(gross - fee, 0);
	const lines: TeamSplitPreview["lines"] = [
		{ key: "fee", kind: "fee", name: null, bp: feeBp, amount: money(fee) },
	];
	if (rule.ruleType === "benevolent_dictator") {
		lines.push({ key: "vault", kind: "vault", name: null, bp: 10_000, amount: money(payout) });
	} else {
		let rest = payout;
		if (rule.ruleType === "finders_fee") {
			const finder = Math.floor((payout * (rule.finderBp ?? 0)) / 10_000);
			rest = payout - finder;
			lines.push({
				key: "finder",
				kind: "finder",
				name: "Ben",
				bp: rule.finderBp,
				amount: money(finder),
			});
		}
		const vault = Math.floor((rest * rule.vaultBp) / 10_000);
		const pool = rest - vault;
		lines.push({ key: "vault", kind: "vault", name: null, bp: rule.vaultBp, amount: money(vault) });
		let paid = 0;
		stakes.forEach((bp, i) => {
			const share = Math.floor((pool * bp) / 10_000);
			paid += share;
			lines.push({ key: `member:${i}`, kind: "member", name: `M${i}`, bp, amount: money(share) });
		});
		lines.push({ key: "dust", kind: "dust", name: null, bp: null, amount: money(pool - paid) });
	}
	const total = lines.reduce((sum, line) => sum + line.amount.minor, 0);
	return {
		currency: "GBP",
		gross: money(gross),
		ruleType: rule.ruleType,
		lines,
		total: money(total),
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
		const preview = mockPreview(gross, 500, rule, stakes);
		const rows = ledgerRows(preview);
		const total = rows.at(-1)!;
		assertEquals(total.kind, "total");
		assertStrictEquals(total.amount.minor, gross, `round ${round}: ${gross}`);
		assertStrictEquals(
			rows.slice(0, -1).reduce((acc, row) => acc + row.amount.minor, 0),
			gross,
			`round ${round}: the rows sum to the amount`,
		);
	}
});

Deno.test("ledgerRows: the plan's order and words — fee, finder, vault, members, dust, total", () => {
	const rows = ledgerRows(mockPreview(100_000, 500, FINDERS, [6000, 4000]));
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
		ledgerRows(mockPreview(100_000, 500, DICTATOR, [])).map((r) => r.kind),
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

Deno.test("the page draws exactly one filled control — the rig's tier-3 Save, and only when dirty", () => {
	for (const ruleType of ALL) {
		for (const editable of [true, false]) {
			for (const drift of [true, false]) {
				for (const uneven of [true, false]) {
					const body = bodyControls({
						ruleType,
						editable,
						locked: true,
						drift,
						uneven,
						members: 4,
					});
					assertStrictEquals(filledButtons(body), 0, `${ruleType}: the body fills nothing`);
					assert(body.every((c) => c.tier === undefined || c.tier > 3));
					for (const dirty of [true, false]) {
						const rig = rigModel(rigFor(dirty));
						assertStrictEquals(filledButtons(body) + rigFilledCount(rig), dirty ? 1 : 0);
						const save = rig.actions.find((a) => a.key === "save");
						assertEquals(save ? save.control === "button" && save.tier : null, dirty ? 3 : null);
						const tiers: number[] = rig.actions.flatMap((a) =>
							a.control === "button" ? [a.tier] : []
						);
						assert(!tiers.includes(1), "no amber tier-1 control");
					}
				}
			}
		}
	}
});

Deno.test("bodyControls: the composition follows the template", () => {
	const keys = (ruleType: (typeof ALL)[number]) =>
		bodyControls({
			ruleType,
			editable: true,
			locked: false,
			drift: false,
			uneven: true,
			members: 2,
		})
			.map((c) => c.key);
	assertEquals(keys("co_op"), [
		"template",
		"vault-cut",
		"stakes",
		"hold-0",
		"hold-1",
		"split-evenly",
		"preview-amount",
		"roles",
	]);
	assertEquals(keys("finders_fee").slice(0, 4), ["template", "vault-cut", "finder", "finder-cut"]);
	assertEquals(keys("benevolent_dictator"), ["template", "finance", "preview-amount", "roles"]);
});
// #endregion
