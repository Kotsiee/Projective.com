/**
 * board-demo.test — the demo stage's Work board (`flows/LANDING.md` §4.4 Work board, §6 V1; §5 rows
 * K1–K6, C4, D1, D2, E1): its fixture against the product's rules, the board model's additions
 * (`previewStart`, `dropRefusalOf`: which lanes refuse a card before it is dropped, as the
 * product's column lock does), the live region's words for every outcome (verbatim §4.4, the fee
 * clause dropped without a fee), the status line, and the six reduced-motion frames — Needs funding
 * from the start, refused, Funded, Review, Team paid, then the same task's next stage paid from the
 * wallet.
 */
import { assert, assertEquals, assertFalse } from "@std/assert";
import { PLATFORM_FEE_BP } from "@projective/types/finance";
import { formatTicketMoney } from "@projective/types/projects";
import {
	approve,
	BOARD_LANES,
	type BoardAction,
	cardById,
	cardView,
	createBoard,
	type DemoBoardState,
	dropRefusalOf,
	fundingNeeded,
	fundingTagOf,
	pay,
	previewStart,
	reduceBoard,
	reset,
	start,
} from "./board-model.ts";
import { DEMO_BOARD, DEMO_FOCUS_CARD, DEMO_SCRIPT } from "./board-fixtures.ts";
import {
	BOARD_DEMO_COPY,
	boardAnnouncement,
	boardFrames,
	boardNotice,
	canPay,
	cardLabel,
	demoMoney,
	frameAnnouncement,
	laneCounter,
	moneyLead,
	moveLabel,
	refusalText,
	stepCounter,
	ticketMoney,
} from "./board-demo.ts";

// #region Helpers
const FEE = { feeBp: PLATFORM_FEE_BP };

function run(state: DemoBoardState, actions: readonly BoardAction[]): DemoBoardState {
	return actions.reduce(reduceBoard, state);
}

const fresh = (feeBp: number | null = PLATFORM_FEE_BP) => createBoard(DEMO_BOARD, { feeBp });
// #endregion

// #region Fixture
Deno.test("the demo board: one task per lane, and the followed task waits in Ready, unpaid", () => {
	const board = fresh();
	assertEquals(board.cards.map((card) => card.status), [...BOARD_LANES]);
	const focus = cardById(board, DEMO_FOCUS_CARD);
	assert(focus);
	assertEquals(focus.status, "todo");
	assertFalse(focus.claimed);
	assertEquals(fundingTagOf(focus), "needs_funding", "the product's tag (#288 (G))");
	assert(board.walletMinor < 200_000, "the wallet is short of the £2,000 stage (K3)");
	assert(board.walletMinor >= 50_000 + 10_000, "and covers both next stages (D1)");
	assertEquals(fundingNeeded(board), { count: 1, totalMinor: 200_000, ids: [DEMO_FOCUS_CARD] });
});
// #endregion

// #region Model additions
Deno.test("previewStart says what a move would do without doing it", () => {
	const board = fresh();
	assertEquals(previewStart(board, DEMO_FOCUS_CARD, "in_progress"), {
		kind: "refused",
		cardId: DEMO_FOCUS_CARD,
		lane: "in_progress",
		reason: "needs_funding",
	});
	assertEquals(board, fresh(), "the board is unchanged");
	assertEquals(previewStart(board, "logo-v2", "in_review"), {
		kind: "moved",
		cardId: "logo-v2",
		lane: "in_review",
	});
	assertEquals(previewStart(board, "missing", "todo"), null);
});

Deno.test("an unclaimed task's start always reaches the reducer: the claim is the attempt", () => {
	const board = fresh();
	assertEquals(dropRefusalOf(board, DEMO_FOCUS_CARD, "in_progress"), null);
	const refused = reduceBoard(board, start(DEMO_FOCUS_CARD, "in_progress"));
	assertEquals(refused.last?.kind, "refused");
	assert(cardById(refused, DEMO_FOCUS_CARD)?.needsFunding, "the refused claim marks Needs funding");
	assertEquals(refused.walletMinor, board.walletMinor);
});

Deno.test("a claimed task with nothing held is refused at the lane, as the product's column lock", () => {
	// Approve Design on a wallet too short for Launch: the same task waits in Ready, claimed.
	const short = createBoard({ ...DEMO_BOARD, walletMinor: 0 }, FEE);
	const waiting = run(short, [
		pay(DEMO_FOCUS_CARD),
		start(DEMO_FOCUS_CARD, "in_progress"),
		start(DEMO_FOCUS_CARD, "in_review"),
		approve(DEMO_FOCUS_CARD),
	]);
	const card = cardById(waiting, DEMO_FOCUS_CARD);
	assert(card?.claimed);
	assertEquals(card?.status, "todo");
	assertEquals(dropRefusalOf(waiting, DEMO_FOCUS_CARD, "in_progress"), "needs_funding");
	assertEquals(
		refusalText("needs_funding"),
		"Needs funding. Pay for this stage before work starts.",
	);
});

Deno.test("moves the board never makes are refused at the lane; planning and work moves are not", () => {
	const board = fresh();
	assertEquals(dropRefusalOf(board, DEMO_FOCUS_CARD, "backlog"), null);
	assertEquals(dropRefusalOf(board, DEMO_FOCUS_CARD, "in_review"), "start_first");
	assertEquals(dropRefusalOf(board, DEMO_FOCUS_CARD, "completed"), "approve_required");
	assertEquals(dropRefusalOf(board, "launch-emails", "in_progress"), "not_payable");
	assertEquals(dropRefusalOf(board, "logo-v2", "todo"), "locked");
	assertEquals(dropRefusalOf(board, "case-study", "in_progress"), null);
	assertEquals(dropRefusalOf(board, "brand-colours", "in_review"), "locked");
	assertEquals(dropRefusalOf(board, DEMO_FOCUS_CARD, "in_progress", "client"), "claim_required");
	assertEquals(refusalText("claim_required"), "A freelancer starts this task by claiming it.");
	for (const reason of ["start_first", "approve_required", "not_payable", "locked"] as const) {
		assertEquals(refusalText(reason), BOARD_DEMO_COPY.outsideExample);
	}
});
// #endregion

// #region Live region and status line
Deno.test("the live region says §4.4's words for every outcome", () => {
	const board = fresh();
	const refused = reduceBoard(board, start(DEMO_FOCUS_CARD, "in_progress"));
	assertEquals(
		boardAnnouncement(refused),
		"Can't start “Homepage design” yet. It needs funding first.",
	);
	const paid = reduceBoard(refused, pay(DEMO_FOCUS_CARD));
	assertEquals(boardAnnouncement(paid), "Paid for “Homepage design”. It can start now.");
	const started = reduceBoard(paid, start(DEMO_FOCUS_CARD, "in_progress"));
	assertEquals(boardAnnouncement(started), "Moved “Homepage design” to In Progress.");
	const review = reduceBoard(started, start(DEMO_FOCUS_CARD, "in_review"));
	assertEquals(boardAnnouncement(review), "Moved “Homepage design” to Review.");
	const approved = reduceBoard(review, approve(DEMO_FOCUS_CARD));
	assertEquals(
		boardAnnouncement(approved),
		"Approved. The team receives £1,900.00. It clears in 7 days. Moved “Homepage design” to In Progress.",
	);
	assertEquals(boardAnnouncement(reduceBoard(approved, reset())), null);
	assertEquals(boardAnnouncement(board), null);
});

Deno.test("without a fee the approval says the team is paid, and never a figure", () => {
	const approved = run(fresh(null), [
		pay(DEMO_FOCUS_CARD),
		start(DEMO_FOCUS_CARD, "in_progress"),
		start(DEMO_FOCUS_CARD, "in_review"),
		approve(DEMO_FOCUS_CARD),
	]);
	assertEquals(
		boardAnnouncement(approved),
		"Approved. The team is paid. It clears in 7 days. Moved “Homepage design” to In Progress.",
	);
	assertEquals(boardNotice(approved), {
		kind: "paid",
		text: "Team paid · clears in 7 days",
		detail: null,
	});
});

Deno.test("an approval on a short wallet says where the task waits", () => {
	const short = createBoard({ ...DEMO_BOARD, walletMinor: 0 }, FEE);
	const approved = run(short, [approve("case-study")]);
	assertEquals(
		boardAnnouncement(approved),
		"Approved. The team receives £142.50. It clears in 7 days. Moved “Case study” to Ready.",
	);
	assertEquals(fundingTagOf(cardById(approved, "case-study")!), "needs_funding");
});

Deno.test("the status line: a refusal's reason, then the Team paid moment with the team's net", () => {
	const board = fresh();
	assertEquals(boardNotice(board), null);
	assertEquals(boardNotice(reduceBoard(board, start(DEMO_FOCUS_CARD, "in_progress"))), {
		kind: "refused",
		text: "Needs funding. Pay for this stage before work starts.",
	});
	assertEquals(boardNotice(reduceBoard(board, start(DEMO_FOCUS_CARD, "completed"))), {
		kind: "refused",
		text: "Not part of this example.",
	});
	assertEquals(boardNotice(reduceBoard(board, approve("case-study"))), {
		kind: "paid",
		text: "Team paid · clears in 7 days",
		detail: "The team receives £142.50 after the 5% fee.",
	});
	assertEquals(boardNotice(reduceBoard(board, pay(DEMO_FOCUS_CARD))), null);
});

Deno.test("a card's price prints exactly as the product's board card prints it", () => {
	for (const minor of [0, 100, 15_000, 25_000, 40_000, 200_000, 250_000, 1_050, 99, 123_456]) {
		assertEquals(ticketMoney(minor), formatTicketMoney(minor, "GBP"), String(minor));
	}
});

Deno.test("money is GBP en-GB, and the small labels read as §4.4 writes them", () => {
	assertEquals(demoMoney(190_000), "£1,900.00");
	assertEquals(demoMoney(60_000), "£600.00");
	assertEquals(moveLabel("Logo v2"), "Move to… “Logo v2”");
	assert(moveLabel("Logo v2").startsWith(BOARD_DEMO_COPY.moveTo), "the name contains its label");
	assertEquals(laneCounter(1), "2 of 5");
	assertEquals(stepCounter(0, 6), "Step 1 of 6");
	assertEquals(BOARD_DEMO_COPY.dragHint, "Drag a card to try starting it.");
	assertEquals(
		BOARD_DEMO_COPY.keyboardHelp,
		"To move a card: Space to pick up, arrow keys to move, Enter to drop, Escape to cancel.",
	);
	assertEquals(BOARD_DEMO_COPY.pay, "Pay for this stage");
	assertEquals(BOARD_DEMO_COPY.approve, "Approve and pay");
});
// #endregion

Deno.test("a card's name says what its face shows: title, stage, tag and price", () => {
	const board = fresh();
	const view = (id: string, state = board) => cardView(cardById(state, id)!);
	assertEquals(
		cardLabel(view(DEMO_FOCUS_CARD)),
		"Homepage design, Design, Needs funding, £2,500",
	);
	const paid = reduceBoard(board, pay(DEMO_FOCUS_CARD));
	assertEquals(cardLabel(view(DEMO_FOCUS_CARD, paid)), "Homepage design, Design, Funded, £2,500");
	assertEquals(cardLabel(view("launch-emails")), "Launch emails, Launch, Draft");
	assertEquals(cardLabel(view("logo-v2")), "Logo v2, Design, £400", "a work lane wears no tag");
});

Deno.test("one filled money control on the board: the followed task's, else the next in lane order", () => {
	const board = fresh();
	// Opening: Homepage design's Pay leads; Case study's Approve and pay waits, outlined.
	assert(canPay(board, DEMO_FOCUS_CARD));
	assertEquals(moneyLead(board), DEMO_FOCUS_CARD);
	// Paid: the followed task has no money action until Review, so Case study's approval leads.
	const paid = reduceBoard(board, pay(DEMO_FOCUS_CARD));
	assertEquals(moneyLead(paid), "case-study");
	// In Review: the followed task's Approve and pay leads again.
	const review = run(paid, [
		start(DEMO_FOCUS_CARD, "in_progress"),
		start(DEMO_FOCUS_CARD, "in_review"),
	]);
	assertEquals(moneyLead(review), DEMO_FOCUS_CARD);
	// Every reachable board's lead, when there is one, has a money action.
	for (const state of [board, paid, review]) {
		const lead = moneyLead(state);
		assert(lead !== null);
		const card = cardById(state, lead)!;
		assert(canPay(state, lead) || (card.status === "in_review" && card.escrow === "held"));
	}
});

// #region Frames
Deno.test("each frame is announced whole: its step, its caption and its second line", () => {
	const frames = boardFrames(PLATFORM_FEE_BP);
	assertEquals(
		frameAnnouncement(frames[5], 5, frames.length),
		"Step 6 of 6. The task moves to its next stage, paid for from your wallet. If your wallet is short, it waits until you pay for it.",
	);
	assertEquals(
		frameAnnouncement(frames[0], 0, frames.length),
		"Step 1 of 6. “Homepage design” waits in Ready. Its tag says Needs funding.",
	);
});

Deno.test("six frames follow one task through the §4.4 story, captioned", () => {
	const frames = boardFrames(PLATFORM_FEE_BP);
	assertEquals(frames.length, 6);
	assertEquals(frames.map((frame) => frame.caption), [
		"“Homepage design” waits in Ready. Its tag says Needs funding.",
		"The freelancer tries to start it. Your wallet is short, so the board says no.",
		"You pay for the stage. The tag changes to Funded.",
		"Work starts. The task moves to In Progress, then Review.",
		"You approve. The team receives £1,900.00 after the 5% fee.",
		"The task moves to its next stage, paid for from your wallet.",
	]);
	assertEquals(frames[5].note, "If your wallet is short, it waits until you pay for it.");
	assert(frames.slice(0, 5).every((frame) => frame.note === null));

	const focus = frames.map((frame) =>
		frame.frame.cards.find((card) => card.id === DEMO_FOCUS_CARD)
	);
	assertEquals(focus.map((card) => card?.lane), [
		"todo",
		"todo",
		"todo",
		"in_review",
		"in_review",
		"in_progress",
	]);
	assertEquals(focus.map((card) => card?.tag ?? null), [
		"needs_funding",
		"needs_funding",
		"funded",
		null,
		"team_paid",
		null,
	]);
	assertEquals(focus[5]?.stageName, "Launch", "the same task, on its next stage");
	assertEquals(frames.map((frame) => frame.lane), [1, 1, 1, 3, 3, 2]);
	assertEquals(frames.map((frame) => frame.walletMinor), [
		60_000,
		60_000,
		60_000,
		60_000,
		60_000,
		10_000,
	]);
	assertEquals(frames[1].frame.beat, { cardId: DEMO_FOCUS_CARD, kind: "refused" });
	assertEquals(frames[4].frame.beat, { cardId: DEMO_FOCUS_CARD, kind: "team_paid" });
});

Deno.test("the frames are the script the live board plays, and drop the fee figure without a fee", () => {
	const played = run(fresh(), DEMO_SCRIPT);
	assertEquals(played.last?.kind, "approved");
	const frames = boardFrames(null);
	assertEquals(frames[4].caption, "You approve. The team is paid.");
	assertFalse(frames.some((frame) => /£1,900|fee/.test(frame.caption)));
	assertEquals(
		boardFrames(250)[4].caption,
		"You approve. The team receives £1,950.00 after the 2.5% fee.",
	);
});

Deno.test("no board copy uses a banned word or an approval absolute (#281, #283)", () => {
	const banned =
		/\b(squad|micro-agency|escrow|release|next card)\b|until you approve|only paid when you approve|instant/i;
	const lines = [
		...Object.values(BOARD_DEMO_COPY),
		...boardFrames(PLATFORM_FEE_BP).flatMap((frame) => [frame.caption, frame.note ?? ""]),
	];
	for (const line of lines) assertFalse(banned.test(line), line);
});
// #endregion
