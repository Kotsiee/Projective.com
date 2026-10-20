/**
 * money-flow.test — "How it works" against its sources: the copy is §4.3's, verbatim, with the fee
 * formatted from the server's basis points and dropped when it is unavailable; the fixture parses
 * as the product's own shapes; the flow's board follows the product (its tags are what
 * `fundingTagState` reads, a work lane wears none); the money moves the way §5's rows say (C2, C4,
 * D1, E1, E2) and is never created or lost; then the stage's plumbing — step spans, and the
 * scroll mapping that picks the step the reading line has reached, on the same line the
 * stylesheet's scroll-linked fills use.
 */
import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	type FundingStatus,
	FundingStatusSchema,
	PLATFORM_FEE_BP,
	platformFeeFor,
} from "@projective/types/finance";
import {
	BoardCardSchema,
	ProjectPartySchema,
	TicketStageRefSchema,
} from "@projective/types/projects";
import { deriveFundingState } from "@server/services/finance/funding-state.ts";
import { fundingTagState } from "@features/projects/core/funding-ui.ts";
import {
	cardTotalMinor,
	createBoard,
	currentStage,
	type DemoCard,
	fundingOf,
	fundingTagOf,
	stagePriceMinor,
} from "./demos/board-model.ts";
import {
	FLOW_BOARD,
	FLOW_CARD_ID,
	FLOW_NODES,
	type FlowFrame,
	flowSteps,
	HOW_IT_WORKS,
	moneyFlowFrames,
	payFromWallet,
	stepSpans,
	stepsWhere,
} from "./money-flow.ts";
import { activeStepAt, FLOW_LINE, flowRootMargin } from "./money-flow-scroll.ts";
import { LANDING_PAGES } from "./js-budget.ts";

// #region Helpers
const FRAMES = moneyFlowFrames(PLATFORM_FEE_BP);
const NO_FEE = moneyFlowFrames(null);

/** Every sentence a visitor reads in the section, fee on. */
function pageText(feeBp: number | null): string {
	const steps = flowSteps(feeBp);
	return [
		HOW_IT_WORKS.heading,
		HOW_IT_WORKS.subline,
		HOW_IT_WORKS.link,
		...steps.flatMap((step) => [step.title, ...step.body]),
	].join(" ");
}

/** What the product derives for `c` (the same mapping `board-model.test.ts` uses). */
function productFunding(c: DemoCard): FundingStatus {
	const amountMinor = stagePriceMinor(c);
	return deriveFundingState(
		{
			status: c.status,
			paymentStatus: c.escrow === "released"
				? "released"
				: c.needsFunding
				? "needs_funding"
				: "unpaid",
			hasDescription: c.described,
			amountMinor,
			currency: "GBP",
		},
		c.escrow === "none" ? null : {
			status: c.escrow === "held" ? "held" : "released",
			amountMinor: amountMinor ?? 0,
			currency: "GBP",
		},
	);
}

/**
 * The sum of every figure the frame DRAWS, plus the fee the platform kept: a place that shows an
 * amount is counted whether or not it holds money, so a picture that showed one sum in two places
 * would not add up.
 */
function totalOf(frame: FlowFrame): number {
	const { wallet, held, team, bank } = frame.nodes;
	return (wallet.amountMinor ?? 0) + (held.amountMinor ?? 0) + (team.amountMinor ?? 0) +
		(bank.amountMinor ?? 0) + (frame.feeMinor ?? 0);
}
// #endregion

// #region Copy
Deno.test("the copy is §4.3's, verbatim, with the fee formatted from the server", () => {
	assertEquals(HOW_IT_WORKS.heading, "How it works");
	assertEquals(HOW_IT_WORKS.subline, "From search to payday in six steps.");
	assertEquals(HOW_IT_WORKS.link, "See it work");
	assertEquals(HOW_IT_WORKS.href, "#demo");
	assertEquals(flowSteps(500), [
		{
			title: "Find your team.",
			body: ["Search for a ready-made team, or post your own project."],
		},
		{
			title: "Pay for the first stage.",
			body: ["Your money is held safely.", "Work only starts once it's paid for."],
		},
		{
			title: "The team gets to work.",
			body: ["Each task moves across its stage's board, from Ready to Review."],
		},
		{
			title: "Review the work.",
			body: [
				"Not quite right? Ask for changes.",
				"If the free rounds run out, extra rounds can be paid for where the terms offer them.",
			],
		},
		{
			title: "Approve and pay.",
			body: [
				"The team is paid, minus the 5% fee.",
				"Does the task have a next stage? Your wallet pays for it straight away when your balance covers it.",
				"You can switch this off for any stage.",
			],
		},
		{
			title: "The team withdraws.",
			body: ["Their money clears in 7 days.", "Then they withdraw it to their bank."],
		},
	]);
	assertEquals(flowSteps(250)[4].body[0], "The team is paid, minus the 2.5% fee.");
});

Deno.test("with the fee unavailable, step 5 drops its fee clause and nothing names a fee", () => {
	const steps = flowSteps(null);
	assertEquals(steps[4].body[0], "The team is paid.");
	assertEquals(steps.length, 6);
	assertFalse(/fee/i.test(pageText(null)), "no fee clause without the fee");
});

Deno.test("no banned word or absolute appears in the section (§4, #281, #283)", () => {
	const text = pageText(PLATFORM_FEE_BP).toLowerCase();
	for (
		const banned of [
			"escrow",
			"release",
			"until you approve",
			"only paid when you approve",
			"next card",
			"squad",
			"instant",
			"kyc",
		]
	) {
		assertFalse(text.includes(banned), banned);
	}
});
// #endregion

// #region The product's shapes and rules
Deno.test("the fixture parses as the product's board card, stage, party and funding shapes", () => {
	const shape = BoardCardSchema.pick({
		id: true,
		title: true,
		hasDescription: true,
		status: true,
		stageId: true,
		claimed: true,
		escrowHeld: true,
		budgetCents: true,
	});
	const stageShape = TicketStageRefSchema.pick({
		stageId: true,
		name: true,
		order: true,
		required: true,
		costCents: true,
	});
	for (const c of FLOW_BOARD.cards) {
		shape.parse({
			id: c.id,
			title: c.title,
			hasDescription: c.described,
			status: c.status,
			stageId: currentStage(c)?.id ?? null,
			claimed: c.claimed,
			escrowHeld: c.escrow === "held",
			budgetCents: cardTotalMinor(c),
		});
		c.stages.forEach((stage, order) =>
			stageShape.parse({
				stageId: stage.id,
				name: stage.name,
				order,
				required: true,
				costCents: stage.priceMinor,
			})
		);
		if (c.assignee) ProjectPartySchema.parse({ ...c.assignee, handle: null });
		FundingStatusSchema.parse({
			...fundingOf(c),
			currency: FLOW_BOARD.currency,
			amountLabel: null,
			reason: null,
		});
	}
});

Deno.test("the board follows the product: lanes, and the tag fundingTagState reads", () => {
	assertEquals(
		FRAMES.map((frame) => frame.lane),
		["todo", "todo", "in_progress", "in_review", "in_progress", "in_progress"],
	);
	assertEquals(
		FRAMES.map((frame) => frame.card.tag),
		["needs_funding", "funded", null, null, null, null],
	);
	const states = [
		createBoard(FLOW_BOARD, { feeBp: PLATFORM_FEE_BP }),
		payFromWallet(createBoard(FLOW_BOARD, { feeBp: PLATFORM_FEE_BP }), FLOW_CARD_ID),
	];
	for (const state of states) {
		for (const c of state.cards) {
			assertEquals(fundingTagOf(c), fundingTagState(productFunding(c)), c.id);
		}
	}
	assertEquals(FRAMES.map((frame) => frame.review), [false, false, false, true, false, false]);
	assertEquals(FRAMES[0].needs.count, 1);
	assertEquals(FRAMES[0].needs.totalMinor, 200_000);
	assertEquals(FRAMES[1].needs.count, 0);
});
// #endregion

// #region Money
Deno.test("paying from the wallet takes exactly the stage's price, with no fee on top (C2)", () => {
	const found = createBoard(FLOW_BOARD, { feeBp: PLATFORM_FEE_BP });
	const funded = payFromWallet(found, FLOW_CARD_ID);
	assertEquals(funded.walletMinor, found.walletMinor - 200_000);
	assertEquals(funded.last, { kind: "paid", cardId: FLOW_CARD_ID, amountMinor: 200_000 });
	const short = payFromWallet({ ...found, walletMinor: 199_999 }, FLOW_CARD_ID);
	assertEquals(short.walletMinor, 199_999);
	assertEquals(short.cards, found.cards, "a short wallet holds nothing");
	assertEquals(short.last?.kind, "refused");
});

Deno.test("the money moves the way §5 says: held, paid minus the fee, chained, cleared, withdrawn", () => {
	const net = 200_000 - platformFeeFor(200_000, PLATFORM_FEE_BP);
	assertEquals(net, 190_000);
	assertEquals(
		FRAMES.map((frame) => frame.nodes.wallet.amountMinor),
		[500_000, 300_000, 300_000, 300_000, 150_000, 150_000],
	);
	assertEquals(
		FRAMES.map((frame) => frame.nodes.held.amountMinor),
		[null, 200_000, 200_000, 200_000, 150_000, 150_000],
	);
	assertEquals(
		FRAMES.map((frame) => frame.nodes.held.status),
		[
			null,
			"Stage 1 · Design",
			"Stage 1 · Design",
			"Stage 1 · Design",
			"Stage 2 · Build",
			"Stage 2 · Build",
		],
	);
	assertEquals(
		FRAMES.map((frame) => frame.nodes.team.amountMinor),
		[null, null, null, null, net, null],
		"withdrawn, the team's place is emptied: the withdrawal took the net out of their wallet",
	);
	assertEquals(FRAMES.map((frame) => frame.nodes.team.status), [
		null,
		null,
		null,
		null,
		"Clearing · 7 days",
		null,
	]);
	assert(FRAMES[5].nodes.team.reached, "the team was paid on the way");
	assertFalse(FRAMES[5].nodes.team.holds);
	assertEquals(FRAMES[5].nodes.team.note, null);
	assertEquals(FRAMES[4].nodes.team.note, "after the 5% fee");
	assertEquals(FRAMES.map((frame) => frame.nodes.bank.amountMinor), [
		null,
		null,
		null,
		null,
		null,
		net,
	]);
	assertEquals(FRAMES[5].nodes.bank.status, "Withdrawal started");
	assertEquals(FRAMES.map((frame) => frame.clearedDays), [0, 0, 0, 0, 0, 7]);
	assertEquals(FRAMES.map((frame) => frame.feeMinor), [null, null, null, null, 10_000, 10_000]);
	assertEquals(FRAMES[1].moves, [{ from: "wallet", to: "held", amountMinor: 200_000 }]);
	assertEquals(FRAMES[4].moves, [
		{ from: "held", to: "team", amountMinor: net },
		{ from: "wallet", to: "held", amountMinor: 150_000 },
	]);
	assertEquals(FRAMES[5].moves, [{ from: "team", to: "bank", amountMinor: net }]);
});

Deno.test("Chain Reaction moves the SAME task to its next stage, held from the wallet (D1)", () => {
	const approved = FRAMES[4];
	assertEquals(approved.card.id, FLOW_CARD_ID);
	assertEquals(approved.card.stageName, "Build");
	assertEquals(approved.lane, "in_progress");
	assertEquals(approved.nodes.held.amountMinor, 150_000);
	assertEquals(FRAMES[3].nodes.wallet.amountMinor! - approved.nodes.wallet.amountMinor!, 150_000);
});

Deno.test("no money is created or lost: every frame adds up to the wallet it started from", () => {
	for (const frame of FRAMES) {
		assertEquals(totalOf(frame), FLOW_BOARD.walletMinor, `step ${frame.step}`);
	}
});

Deno.test("with the fee unavailable the team's amounts are unknown, never guessed", () => {
	assertEquals(NO_FEE[4].nodes.team.amountMinor, null);
	assertEquals(NO_FEE[4].nodes.team.note, null);
	assertEquals(NO_FEE[4].feeMinor, null);
	assertEquals(NO_FEE[5].nodes.bank.amountMinor, null);
	assertEquals(NO_FEE[4].moves[0].amountMinor, null);
	assertEquals(NO_FEE[4].nodes.team.status, "Clearing · 7 days");
	assertEquals(NO_FEE[4].nodes.wallet.amountMinor, 150_000, "the client's side is still known");
});

Deno.test("every frame names each place, and money rests where the story says", () => {
	for (const frame of FRAMES) assertEquals(Object.keys(frame.nodes).sort(), [...FLOW_NODES].sort());
	assertEquals(stepsWhere(FRAMES, (frame) => frame.nodes.held.holds), [2, 3, 4, 5, 6]);
	assertEquals(stepsWhere(FRAMES, (frame) => frame.nodes.team.holds), [5]);
	assertEquals(stepsWhere(FRAMES, (frame) => frame.nodes.bank.holds), [6]);
	assertEquals(FRAMES.map((frame) => frame.focus), [
		"board",
		"money",
		"board",
		"board",
		"money",
		"money",
	]);
});

Deno.test("the frames are deterministic", () => {
	assertEquals(moneyFlowFrames(PLATFORM_FEE_BP), FRAMES);
});
// #endregion

// #region Stage plumbing
Deno.test("stepSpans groups a per-step sequence by value, in order of first appearance", () => {
	assertEquals(stepSpans([5, 3, 3, 3, 1, 1]), [
		{ value: 5, steps: [1] },
		{ value: 3, steps: [2, 3, 4] },
		{ value: 1, steps: [5, 6] },
	]);
	assertEquals(stepSpans([null, "a", null]), [
		{ value: null, steps: [1, 3] },
		{ value: "a", steps: [2] },
	]);
	assertEquals(stepSpans([{ n: 1 }, { n: 1 }]).length, 1, "keyed by value, not identity");
	assertEquals(stepSpans([]), []);
});

Deno.test("activeStepAt: the last step whose top has reached the line, the first before any has", () => {
	const tops = [100, 400, 700, 1000];
	assertEquals(activeStepAt(tops, 50), 0, "before the first: the flow starts at the beginning");
	assertEquals(activeStepAt(tops, 100), 0, "a top exactly on the line has reached it");
	assertEquals(activeStepAt(tops, 399), 0);
	assertEquals(activeStepAt(tops, 400), 1);
	assertEquals(activeStepAt(tops, 950), 2);
	assertEquals(activeStepAt(tops, 5000), 3, "past the last: the last stays");
	assertEquals(activeStepAt([-900, -600, -300, 120], 320), 3, "scrolled into the section");
	assertEquals(activeStepAt([], 320), 0);
});

Deno.test("the observer watches a 1% band whose top edge is the reading line", () => {
	assertEquals(flowRootMargin(0.4), "-40% 0px -59% 0px");
	assertEquals(flowRootMargin(0.5), "-50% 0px -49% 0px");
	assertEquals(flowRootMargin(), flowRootMargin(FLOW_LINE));
});

Deno.test("the stylesheet's scroll-linked fills use the island's reading line", () => {
	const css = Deno.readTextFileSync(new URL("../styles/lp-money-flow.css", import.meta.url));
	const line = css.match(/--mf-line:\s*([\d.]+)%/);
	assert(line, "lp-money-flow.css declares --mf-line");
	assertEquals(Number(line[1]) / 100, FLOW_LINE);
	assert(
		/view-timeline-inset:\s*var\(--mf-line\)/.test(css),
		"the step timelines are inset to the line",
	);
});

Deno.test("the MoneyFlow island is on the landing's budget, within its own-weight cap", () => {
	const home = LANDING_PAGES.find((page) => page.path === "/");
	const island = home?.islands.find((entry) =>
		entry.path === "apps/web/features/landing/islands/MoneyFlow.island.tsx"
	);
	assert(island, "MoneyFlow is listed on /");
	assert(island.ownMax !== undefined && island.ownMax <= 8_000, "own weight capped at 8 kB");
});
// #endregion
