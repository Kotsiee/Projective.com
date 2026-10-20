/**
 * board-model.test — the work-board simulation against the product's own rules: the fixtures parse
 * as the real `@projective/types` shapes, funding is what `deriveFundingState` derives, the header
 * counts what `fundingRollup` counts, the tag reads what `fundingTagState` reads (and agrees with the
 * header), the claim refusal is the column lock, and the money moves the
 * way §5's rows say (K1–K8, B3, B4, C4, D1, D2, E1). Then the reducer's own contract: refusal,
 * pay → start, approve → net, Chain Reaction on the same task (and waiting when the wallet is
 * short), reset, determinism, and the hero loop's frames.
 */
import { assert, assertEquals, assertFalse, assertNotStrictEquals } from "@std/assert";
import {
	type FundingStatus,
	FundingStatusSchema,
	PLATFORM_FEE_BP,
	platformFeeFor,
} from "@projective/types/finance";
import {
	BoardCardSchema,
	ProjectPartySchema,
	TICKET_COLUMN_LABEL,
	TICKET_STATUS_COLUMNS,
	ticketColumnStatus,
	TicketStageRefSchema,
	workColumnLocked,
} from "@projective/types/projects";
import { deriveFundingState } from "@server/services/finance/funding-state.ts";
import {
	FUNDING_STATE_LABEL,
	FUNDING_TONE,
	fundingRollup,
	fundingTagState,
} from "@features/projects/core/funding-ui.ts";
import {
	approve,
	BOARD_LANES,
	type BoardAction,
	cardById,
	cardTotalMinor,
	cardView,
	CLEARS_IN_DAYS,
	createBoard,
	currentStage,
	type DemoBoardFixture,
	type DemoBoardState,
	type DemoCard,
	FUNDING_TAG_LABEL,
	FUNDING_TAG_TONE,
	fundingNeeded,
	fundingOf,
	type FundingTag,
	fundingTagOf,
	LANE_LABEL,
	pay,
	payoutOf,
	reduceBoard,
	reset,
	scriptFrames,
	stagePriceMinor,
	start,
} from "./board-model.ts";
import { DEMO_BOARD, DEMO_SCRIPT, HERO_BOARD, HERO_LOOP } from "./board-fixtures.ts";

// #region Helpers
const FEE = { feeBp: PLATFORM_FEE_BP };

/** Runs `actions` from `state`, returning the final board. */
function run(state: DemoBoardState, actions: readonly BoardAction[]): DemoBoardState {
	return actions.reduce(reduceBoard, state);
}

/** The card `id`, which must exist. */
function card(state: DemoBoardState, id: string): DemoCard {
	const found = cardById(state, id);
	assert(found, `no card ${id}`);
	return found;
}

/** What the product derives for `c`, from the ticket and escrow facts the card stands for. */
function productFunding(c: DemoCard, currency = "GBP"): FundingStatus {
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
			currency,
		},
		c.escrow === "none" ? null : {
			status: c.escrow === "held" ? "held" : "released",
			amountMinor: amountMinor ?? 0,
			currency,
		},
	);
}

/** One ticket in Ready on a single £2,000 stage with two stages to go — the V1 frames' "Homepage design". */
function v1Board(walletMinor: number, chainReaction = true): DemoBoardState {
	const fixture: DemoBoardFixture = {
		title: "Website refresh",
		currency: "GBP",
		walletMinor,
		cards: [{
			id: "homepage",
			title: "Homepage design",
			described: true,
			stages: [
				{ id: "design", name: "Design", priceMinor: 200_000, chainReaction: true },
				{ id: "build", name: "Build", priceMinor: 120_000, chainReaction },
			],
			stageIndex: 0,
			status: "todo",
			claimed: false,
			escrow: "none",
			needsFunding: false,
			assignee: null,
		}],
	};
	return createBoard(fixture, FEE);
}

/** Every action the board accepts for every card: each lane by each side, pay and approve. */
function everyAction(state: DemoBoardState): BoardAction[] {
	return state.cards.flatMap((c) => [
		...BOARD_LANES.flatMap((lane) => [start(c.id, lane), start(c.id, lane, "client")]),
		pay(c.id),
		approve(c.id),
	]);
}

/** Every board reachable from `roots` in up to `depth` actions. */
function explore(roots: readonly DemoBoardState[], depth: number): DemoBoardState[] {
	let frontier = [...roots];
	const all = [...roots];
	for (let level = 0; level < depth; level += 1) {
		frontier = frontier.flatMap((state) => everyAction(state).map((a) => reduceBoard(state, a)));
		all.push(...frontier);
	}
	return all;
}

/** The V1 ticket approved on a short wallet: claimed, waiting in Ready for its next stage. */
const WAITING = run(v1Board(0), [
	pay("homepage"),
	start("homepage", "in_progress"),
	start("homepage", "in_review"),
	approve("homepage"),
]);

const ROOTS = [
	createBoard(HERO_BOARD, FEE),
	createBoard(DEMO_BOARD, FEE),
	v1Board(0),
	v1Board(500_000),
	v1Board(500_000, false),
	WAITING,
];

const REACHABLE = explore(ROOTS, 2);
// #endregion

// #region The product's shapes and rules
Deno.test("the hero and demo fixtures parse as the product's board card, stage and funding shapes", () => {
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
	for (
		const [c, currency] of [HERO_BOARD, DEMO_BOARD].flatMap((b) =>
			b.cards.map((card) => [card, b.currency] as const)
		)
	) {
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
			currency,
			amountLabel: null,
			reason: null,
		});
	}
});

Deno.test("funding is what deriveFundingState derives, on every reachable board", () => {
	for (const state of REACHABLE) {
		for (const c of state.cards) {
			const ours = fundingOf(c);
			const theirs = productFunding(c);
			assertEquals(
				{ state: ours.state, nextAction: ours.nextAction, canStart: ours.canStart },
				{ state: theirs.state, nextAction: theirs.nextAction, canStart: theirs.canStart },
				`${c.id} (${c.status}, ${c.escrow})`,
			);
		}
	}
});

Deno.test("the lanes are the product's five ticket_status lanes, and every card sits in its own", () => {
	assertEquals(LANE_LABEL, TICKET_COLUMN_LABEL);
	assertEquals(BOARD_LANES, TICKET_STATUS_COLUMNS);
	assertFalse(Object.values(LANE_LABEL).includes("Needs funding"), "a tag, never a column");
	for (const state of REACHABLE) {
		for (const c of state.cards) assertEquals(cardView(c).lane, ticketColumnStatus(c.status));
	}
});

Deno.test("the header counts what the product's fundingRollup counts", () => {
	for (const state of REACHABLE) {
		const theirs = fundingRollup(
			state.cards.map((c) => ({ id: c.id, funding: productFunding(c) })),
		);
		const ours = fundingNeeded(state);
		assertEquals(
			{ count: ours.count, total: ours.totalMinor, ids: ours.ids },
			{ count: theirs.count, total: theirs.totalMinor, ids: theirs.ids },
		);
	}
});

Deno.test("the tag reads what the product's fundingTagState reads, and agrees with the header", () => {
	for (const state of REACHABLE) {
		const asked = new Set(fundingNeeded(state).ids);
		for (const c of state.cards) {
			const product = fundingTagState(productFunding(c));
			const expected: FundingTag = product === "released" ? "team_paid" : product;
			assertEquals(fundingTagOf(c), expected, `${c.id} (${c.status}, ${c.escrow})`);
			assertEquals(fundingTagOf(c) === "needs_funding", asked.has(c.id), c.id);
		}
	}
});

Deno.test("the tags' words and tones are the product's, a release reading Team paid", () => {
	for (const [tag, label] of Object.entries(FUNDING_TAG_LABEL) as Array<[FundingTag, string]>) {
		if (tag === "team_paid") {
			assertEquals(label, "Team paid");
			continue;
		}
		assertEquals(label, FUNDING_STATE_LABEL[tag], tag);
		assertEquals(FUNDING_TAG_TONE[tag], FUNDING_TONE[tag], tag);
	}
});

Deno.test("a card in a work lane wears no tag: its lane says it, as on the product's card", () => {
	for (const state of REACHABLE) {
		for (const c of state.cards) {
			const view = cardView(c);
			if (c.status === "in_progress" || c.status === "in_review") {
				assertEquals(view.tag, null, `${c.id} in ${c.status}`);
			}
		}
	}
});

Deno.test("a claimed task is refused work exactly where the product's column lock refuses it", () => {
	let checked = 0;
	for (const state of REACHABLE) {
		for (const c of state.cards) {
			if (!c.claimed || c.status === "completed" || c.status === "in_progress") continue;
			if (c.status === "in_review") continue;
			const locked = workColumnLocked(
				{
					claimed: c.claimed,
					status: c.status,
					escrowHeld: c.escrow === "held",
					funding: { canStart: fundingOf(c).canStart },
				},
				"in_progress",
			);
			const outcome = reduceBoard(state, start(c.id, "in_progress")).last;
			const refused = outcome?.kind === "refused" && outcome.reason === "needs_funding";
			assertEquals(refused, locked, `${c.id} in ${c.status}`);
			checked += 1;
		}
	}
	assert(checked > 0, "some claimed task stood outside work");
});
// #endregion

// #region The hero board (§4.1)
Deno.test("the hero board's middle frame: one card per lane, tagged as the product's card tags it", () => {
	const board = createBoard(HERO_BOARD, FEE);
	const views = board.cards.map(cardView);
	assertEquals(views.map((v) => [v.title, v.lane]), [
		["Launch emails", "backlog"],
		["Logo v2", "todo"],
		["Homepage design", "in_progress"],
		["Case study", "in_review"],
		["Brand colours", "completed"],
	]);
	assertEquals(views.map((v) => (v.tag ? FUNDING_TAG_LABEL[v.tag] : null)), [
		"Draft",
		"Needs funding",
		null,
		null,
		"Team paid",
	]);
	assertEquals(views.map((v) => v.awaitsApproval), [false, false, false, true, false]);
	assertEquals(views.map((v) => v.totalMinor), [null, 40_000, 200_000, 25_000, 30_000]);
	const needs = fundingNeeded(board);
	assertEquals([needs.count, needs.totalMinor, needs.ids], [1, 40_000, ["logo-v2"]]);
});

Deno.test("the hero loop: Team paid where it stands, then the same task moves to its funded next stage", () => {
	const frames = scriptFrames(createBoard(HERO_BOARD, FEE), HERO_LOOP);
	assertEquals(frames.length, 3);
	const study = (i: number) => frames[i].cards.find((c) => c.id === "case-study");

	assertEquals(frames[0].beat, null);
	assertEquals(study(0)?.lane, "in_review");
	assertEquals(study(0)?.awaitsApproval, true);

	assertEquals(frames[1].beat, { cardId: "case-study", kind: "team_paid" });
	assertEquals([study(1)?.lane, study(1)?.tag, study(1)?.awaitsApproval], [
		"in_review",
		"team_paid",
		false,
	]);

	assertEquals(frames[2].beat, { cardId: "case-study", kind: "moved" });
	assertEquals([study(2)?.lane, study(2)?.stageName, study(2)?.tag], [
		"in_progress",
		"Launch",
		null,
	]);
	assertEquals(frames[2].cards.find((c) => c.id === "case-study")?.totalMinor, 25_000);
	for (const frame of frames) {
		assertEquals([frame.needs.count, frame.needs.totalMinor], [1, 40_000], "Logo v2 still waits");
		for (const other of frame.cards.filter((c) => c.id !== "case-study")) {
			assertEquals(other, frames[0].cards.find((c) => c.id === other.id));
		}
	}
});
// #endregion

// #region Starting work (B3, B4, K2–K6)
Deno.test("an unfunded task cannot start: the claim tries the wallet and, short, is refused", () => {
	const board = createBoard(HERO_BOARD, FEE);
	const next = reduceBoard(board, start("logo-v2", "in_progress"));
	assertEquals(next.last, {
		kind: "refused",
		cardId: "logo-v2",
		lane: "in_progress",
		reason: "needs_funding",
	});
	assertEquals(card(next, "logo-v2").status, "todo");
	assertEquals(next.walletMinor, board.walletMinor);
	assertEquals(fundingTagOf(card(next, "logo-v2")), "needs_funding");
});

Deno.test("V1: unpaid reads Needs funding, a refused start keeps it, pay → Funded, then work", () => {
	let board = v1Board(0);
	// A described, priced ticket nobody has paid for: the product's card reads Needs funding
	// (`fundingTagState`), though its state is Draft (Decision #288 (G) on #287 FLAG (B)).
	assertEquals(fundingOf(card(board, "homepage")).state, "draft");
	assertEquals(fundingTagOf(card(board, "homepage")), "needs_funding");

	board = reduceBoard(board, start("homepage", "in_progress"));
	assertEquals(board.last?.kind, "refused");
	assertEquals(fundingTagOf(card(board, "homepage")), "needs_funding");

	board = reduceBoard(board, pay("homepage"));
	assertEquals(board.last, { kind: "paid", cardId: "homepage", amountMinor: 200_000 });
	assertEquals(fundingTagOf(card(board, "homepage")), "funded");
	assertEquals(board.walletMinor, 0, "paying is the checkout; the wallet is untouched");
	assertEquals(fundingNeeded(board).count, 0);

	board = reduceBoard(board, start("homepage", "in_progress"));
	assertEquals(board.last, {
		kind: "started",
		cardId: "homepage",
		lane: "in_progress",
		heldFrom: "escrow",
	});
	assert(card(board, "homepage").claimed);

	board = reduceBoard(board, start("homepage", "in_review"));
	assertEquals(board.last, { kind: "moved", cardId: "homepage", lane: "in_review" });
	assertEquals(cardView(card(board, "homepage")).awaitsApproval, true);
});

Deno.test("a claim takes the hold from the wallet when the balance covers the exact price", () => {
	const board = reduceBoard(v1Board(250_000), start("homepage", "in_progress"));
	assertEquals(board.last?.kind, "started");
	assertEquals(board.walletMinor, 50_000);
	assertEquals(card(board, "homepage").escrow, "held");
});

Deno.test("a claim makes the claimer the assignee, so a work lane never shows an unassigned card", () => {
	const noor = { name: "Noor", avatar: "/test_images/profile_6.jpg" };
	const board = (walletMinor: number) =>
		createBoard({ ...v1Board(walletMinor).origin, freelancer: noor }, FEE);
	// Claimed with the wallet's hold.
	const claimed = reduceBoard(board(250_000), start("homepage", "in_progress"));
	assertEquals(card(claimed, "homepage").assignee, noor);
	// Claimed after the client paid: the escrow is already held.
	const paid = reduceBoard(board(0), pay("homepage"));
	const started = reduceBoard(paid, start("homepage", "in_progress"));
	assertEquals(card(started, "homepage").assignee, noor);
	// A refused claim assigns nobody.
	const refused = reduceBoard(board(0), start("homepage", "in_progress"));
	assertEquals(card(refused, "homepage").assignee, null);
	// The demo stage's own board: every card in a work lane, after its frames, has an assignee.
	const frames = scriptFrames(createBoard(DEMO_BOARD, FEE), DEMO_SCRIPT);
	for (const frame of frames) {
		for (const view of frame.cards) {
			if (view.lane === "in_progress" || view.lane === "in_review") {
				assert(view.assignee !== null, `${view.title} in ${view.lane} has an assignee`);
			}
		}
	}
});

Deno.test("a client cannot start an unclaimed task; a freelancer starts it by claiming it", () => {
	const funded = reduceBoard(v1Board(0), pay("homepage"));
	const next = reduceBoard(funded, start("homepage", "in_progress", "client"));
	assertEquals(next.last, {
		kind: "refused",
		cardId: "homepage",
		lane: "in_progress",
		reason: "claim_required",
	});
	assertEquals(card(next, "homepage").status, "todo");
});

Deno.test("a Draft can be neither paid for nor claimed, and only approval completes a task", () => {
	const board = createBoard(HERO_BOARD, FEE);
	assertEquals(reduceBoard(board, pay("launch-emails")).last, {
		kind: "refused",
		cardId: "launch-emails",
		lane: null,
		reason: "not_payable",
	});
	const claimed = reduceBoard(board, start("launch-emails", "in_progress")).last;
	assertEquals(claimed?.kind === "refused" && claimed.reason, "not_payable");
	const done = reduceBoard(board, start("case-study", "completed")).last;
	assertEquals(done?.kind === "refused" && done.reason, "approve_required");
	const early = reduceBoard(board, approve("homepage-design")).last;
	assertEquals(early?.kind === "refused" && early.reason, "not_in_review");
	const out = reduceBoard(board, start("homepage-design", "todo")).last;
	assertEquals(out?.kind === "refused" && out.reason, "locked");
	const skip = reduceBoard(board, start("logo-v2", "in_review")).last;
	assertEquals(skip?.kind === "refused" && skip.reason, "start_first");
});

Deno.test("planning moves outside work need no money", () => {
	const board = reduceBoard(createBoard(HERO_BOARD, FEE), start("launch-emails", "todo", "client"));
	assertEquals(board.last, { kind: "moved", cardId: "launch-emails", lane: "todo" });
	assertEquals(fundingTagOf(card(board, "launch-emails")), "draft");
});
// #endregion

// #region Approving (C4, D1, D2, E1)
Deno.test("approve pays the team the price minus the platform fee, truncated like SQL", () => {
	const board = reduceBoard(createBoard(HERO_BOARD, FEE), approve("case-study"));
	const outcome = board.last;
	assert(outcome?.kind === "approved");
	assertEquals(outcome.payout, {
		cardId: "case-study",
		stageId: "stage-design",
		grossMinor: 15_000,
		feeMinor: 750,
		netMinor: 14_250,
		clearsInDays: CLEARS_IN_DAYS,
	});
	assertEquals(board.payouts, [outcome.payout]);
	assertEquals(CLEARS_IN_DAYS, 7);

	// §5 C4's arithmetic, at today's 500 bp.
	assertEquals(payoutOf(200_000, 500), { feeMinor: 10_000, netMinor: 190_000 });
	assertEquals(payoutOf(150_000, 500), { feeMinor: 7_500, netMinor: 142_500 });
});

Deno.test("the fee basis points come from the server, and an unknown fee leaves the net unknown", () => {
	const at = (feeBp: number | null) => {
		const outcome = reduceBoard(createBoard(HERO_BOARD, { feeBp }), approve("case-study")).last;
		assert(outcome?.kind === "approved");
		return outcome.payout;
	};
	assertEquals(at(333).feeMinor, platformFeeFor(15_000, 333));
	assertEquals(at(333), { ...at(333), feeMinor: 499, netMinor: 14_501 });
	assertEquals([at(null).feeMinor, at(null).netMinor, at(null).grossMinor], [null, null, 15_000]);
});

Deno.test("Chain Reaction funds the SAME task's next stage from the wallet — never the next card", () => {
	const before = createBoard(HERO_BOARD, FEE);
	const after = reduceBoard(before, approve("case-study"));
	const outcome = after.last;
	assert(outcome?.kind === "approved");
	assertEquals(outcome.next, { kind: "chain_held", stageId: "stage-launch", amountMinor: 10_000 });
	const study = card(after, "case-study");
	assertEquals([study.stageIndex, study.status, study.escrow], [1, "in_progress", "held"]);
	assertEquals(currentStage(study)?.name, "Launch");
	assertEquals(after.walletMinor, before.walletMinor - 10_000);
	for (const other of after.cards.filter((c) => c.id !== "case-study")) {
		assertEquals(other, card(before, other.id));
	}
});

Deno.test("when the wallet is short the next stage waits, Needs funding, until the client pays", () => {
	let board = run(v1Board(0), [
		pay("homepage"),
		start("homepage", "in_progress"),
		start("homepage", "in_review"),
		approve("homepage"),
	]);
	const outcome = board.last;
	assert(outcome?.kind === "approved");
	assertEquals(outcome.payout.netMinor, 190_000, "the approval and its payout stand");
	assertEquals(outcome.next, {
		kind: "chain_needs_funding",
		stageId: "build",
		amountMinor: 120_000,
	});
	const waiting = card(board, "homepage");
	assertEquals([waiting.status, waiting.escrow, waiting.stageIndex], ["todo", "none", 1]);
	assertEquals(fundingTagOf(waiting), "needs_funding");
	assertEquals(board.walletMinor, 0);

	const refused = reduceBoard(board, start("homepage", "in_progress")).last;
	assertEquals(refused?.kind === "refused" && refused.reason, "needs_funding");

	board = run(board, [pay("homepage"), start("homepage", "in_progress")]);
	assertEquals(board.last?.kind, "started");
	assertEquals(card(board, "homepage").status, "in_progress");
});

Deno.test("with Chain Reaction off the task moves on unpaid, asking to be funded, and nothing is held", () => {
	const board = run(v1Board(500_000, false), [
		pay("homepage"),
		start("homepage", "in_progress"),
		start("homepage", "in_review"),
		approve("homepage"),
	]);
	const outcome = board.last;
	assert(outcome?.kind === "approved");
	assertEquals(outcome.next, { kind: "chain_off", stageId: "build" });
	const next = card(board, "homepage");
	assertEquals([next.status, next.escrow, next.needsFunding], ["todo", "none", false]);
	assertEquals(fundingOf(next).state, "draft");
	assertEquals(fundingTagOf(next), "needs_funding");
	assertEquals(board.walletMinor, 500_000);
});

Deno.test("the final stage completes the task: Completed, Team paid", () => {
	const board = run(createBoard(HERO_BOARD, FEE), [
		approve("case-study"),
		start("case-study", "in_review"),
		approve("case-study"),
	]);
	const outcome = board.last;
	assert(outcome?.kind === "approved");
	assertEquals(outcome.next, { kind: "completed" });
	assertEquals(outcome.payout.netMinor, 10_000 - platformFeeFor(10_000, PLATFORM_FEE_BP));
	const done = card(board, "case-study");
	assertEquals([done.status, fundingTagOf(done)], ["completed", "team_paid"]);
	assertEquals(board.payouts.length, 2);
});
// #endregion

// #region Reset and determinism
Deno.test("reset returns to the fixture and keeps the server's fee", () => {
	const played = run(createBoard(HERO_BOARD, { feeBp: 333 }), [
		approve("case-study"),
		pay("logo-v2"),
		start("logo-v2", "in_progress"),
	]);
	const back = reduceBoard(played, reset());
	assertEquals(back.cards, HERO_BOARD.cards);
	assertEquals(back.walletMinor, HERO_BOARD.walletMinor);
	assertEquals(back.payouts, []);
	assertEquals(back.feeBp, 333);
	assertEquals(back.last, { kind: "reset" });
});

Deno.test("the reducer is pure and deterministic", () => {
	const script: BoardAction[] = [
		start("logo-v2", "in_progress"),
		pay("logo-v2"),
		start("logo-v2", "in_progress"),
		start("logo-v2", "in_review"),
		approve("logo-v2"),
		approve("case-study"),
		reset(),
		approve("case-study"),
	];
	const board = createBoard(HERO_BOARD, FEE);
	const snapshot = structuredClone(board);
	const once = run(board, script);
	const twice = run(board, script);
	assertEquals(once, twice);
	assertEquals(board, snapshot, "the input board is never changed");
	assertEquals(scriptFrames(board, HERO_LOOP), scriptFrames(board, HERO_LOOP));
	assertNotStrictEquals(reduceBoard(board, approve("case-study")), board);
	assertEquals(reduceBoard(board, approve("nobody")), board);
});

Deno.test("a refusal moves no card and no money", () => {
	let refusals = 0;
	for (const state of explore(ROOTS, 1)) {
		for (const action of everyAction(state)) {
			const next = reduceBoard(state, action);
			if (next.last?.kind !== "refused") continue;
			refusals += 1;
			const was = card(state, next.last.cardId);
			const now = card(next, next.last.cardId);
			assertEquals(
				[now.status, now.stageIndex, now.escrow, now.claimed],
				[was.status, was.stageIndex, was.escrow, was.claimed],
			);
			assertEquals([next.walletMinor, next.payouts], [state.walletMinor, state.payouts]);
		}
	}
	assert(refusals > 0);
});
// #endregion
