/**
 * money-flow — "How it works" (`flows/LANDING.md` §4.3, `id="how-it-works"`) as data: its copy,
 * verbatim, and the ONE money flow its sticky stage shows advancing as the visitor scrolls through
 * the six steps (Decision #288 (F)). Pure and deterministic: no clock, no network, no writes.
 *
 * The flow follows one task, "Product pages" of a "Shop relaunch" project, hired to a ready-made
 * team in two stages (Design £2,000, then Build £1,500), from the client's £5,000 wallet. It is its
 * own project and task, not the hero's or the demo stage's "Website refresh · Homepage design",
 * which tell that board's story at other moments; one page never tells the same task three ways.
 *
 *   1. Find your team — the task waits in Ready, priced and described, so its tag asks for funding
 *      (the product's `fundingTagState`, Decision #288 (G)).
 *   2. Pay for the first stage — paid from the wallet: it goes down by exactly the stage's price,
 *      with no fee on top (C2), and the money is held; the tag reads Funded (K4).
 *   3. The team gets to work — the task moves to In Progress; a work lane says it, so the card wears
 *      no tag, as on the product's card.
 *   4. Review the work — the task is in Review: "Ask for changes" or "Approve and pay" (M1).
 *   5. Approve and pay — the team is paid the price minus `platformFeeFor(price, feeBp)`, truncated
 *      as SQL truncates (C1, C4), clearing in 7 days (E1); Chain Reaction moves THE SAME task to its
 *      next stage and holds it from the wallet, which covers it (D1).
 *   6. The team withdraws — once the 7 days clear the money is Available, and the withdrawal goes
 *      to their bank (E1, E2). A started withdrawal takes the amount out of the team's wallet at
 *      once (`finance.begin_payout` → `fn_wallet_debit`), so the team's place is shown emptied and
 *      the bank carries the money: one sum, moving.
 *
 * The board's half is the work-board model the hero theatre and the demo stage use
 * (`demos/board-model.ts`): its lanes, its tags and its reducer, so the stage mirrors the product.
 * The team's half (clearing, then withdrawing) is the wallet side the board does not model.
 * With the platform fee unavailable (`feeBp` `null`), every fee clause drops (§4 "If the fee is
 * unavailable"): step 5 reads "The team is paid.", and the team's amounts are unknown.
 */
import { formatFeePercent } from "@features/marketing/about/core/metric-format.ts";
import {
	approve,
	type BoardLane,
	cardById,
	cardView,
	CLEARS_IN_DAYS,
	createBoard,
	currentStage,
	type DemoBoardFixture,
	type DemoBoardState,
	type DemoCard,
	type DemoCardView,
	type DemoPayout,
	type FundingNeeded,
	fundingNeeded,
	pay,
	reduceBoard,
	stagePriceMinor,
	start,
} from "./demos/board-model.ts";

// #region Copy
/** The section's words (`flows/LANDING.md` §4.3; §5 rows cited per step in {@link flowSteps}). */
export const HOW_IT_WORKS = {
	heading: "How it works",
	subline: "From search to payday in six steps.",
	link: "See it work",
	/** The demo stage's anchor (work order L3 renders it). */
	href: "#demo",
} as const;

/** One step's words. */
export interface FlowStepCopy {
	/** Its heading. */
	title: string;
	/** Its sentences, in order. */
	body: readonly string[];
}

/**
 * The six steps, verbatim from §4.3 — rows A3, L5 · B1, B3 · K1 · M1, M2 · B2, C1, D1 · E1, E2.
 * Step 5's first sentence names the fee, formatted from the server's basis points (500 → "5%"),
 * and falls back to "The team is paid." when the fee is unavailable.
 */
export function flowSteps(feeBp: number | null): FlowStepCopy[] {
	const paid = feeBp === null
		? "The team is paid."
		: `The team is paid, minus the ${formatFeePercent(feeBp)} fee.`;
	return [
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
				paid,
				"Does the task have a next stage? Your wallet pays for it straight away when your balance covers it.",
				"You can switch this off for any stage.",
			],
		},
		{
			title: "The team withdraws.",
			body: [
				`Their money clears in ${CLEARS_IN_DAYS} days.`,
				"Then they withdraw it to their bank.",
			],
		},
	];
}

/** The stage's own labels: the places money passes through and their states (§4.4 V1/V2 words). */
export const FLOW_WORDS = {
	board: "Work board",
	/** Pictures of the product's two review controls (M1; V1's approve button). */
	askForChanges: "Ask for changes",
	approveAndPay: "Approve and pay",
	available: "Available",
	clearing: `Clearing · ${CLEARS_IN_DAYS} days`,
	withdrawal: "Withdrawal started",
	/** "after the 5% fee" (C4). */
	afterFee: (fee: string) => `after the ${fee} fee`,
} as const;
// #endregion

// #region Fixture
/** The task the flow follows. */
export const FLOW_CARD_ID = "product-pages";

/**
 * The board the flow runs on, its "Shop relaunch" project: one task, "Product pages", hired to a
 * ready-made team, priced in two stages with Chain Reaction on (the product's default), and a
 * client wallet that covers both. Checked against the product's `@projective/types` shapes in
 * `money-flow.test.ts`.
 */
export const FLOW_BOARD: DemoBoardFixture = {
	title: "Shop relaunch",
	currency: "GBP",
	walletMinor: 500_000,
	cards: [
		{
			id: FLOW_CARD_ID,
			title: "Product pages",
			described: true,
			stages: [
				{ id: "stage-design", name: "Design", priceMinor: 200_000, chainReaction: true },
				{ id: "stage-build", name: "Build", priceMinor: 150_000, chainReaction: true },
			],
			stageIndex: 0,
			status: "todo",
			claimed: false,
			escrow: "none",
			needsFunding: false,
			assignee: { name: "Northlight Studio", avatar: "/test_images/profile_2.webp" },
		},
	],
};

// #endregion

// #region Model
/** The four places the stage's money passes through, left to right. */
export type FlowNode = "wallet" | "held" | "team" | "bank";

/** The places, in the order money moves through them. */
export const FLOW_NODES: readonly FlowNode[] = ["wallet", "held", "team", "bank"];

/** Each place's label (the V2 stepper's words: Held safely → Team paid → … → Withdraw to bank). */
export const FLOW_NODE_LABEL: Readonly<Record<FlowNode, string>> = {
	wallet: "Your wallet",
	held: "Held safely",
	team: "Team paid",
	bank: "Their bank",
};

/** What one place shows in a frame. */
export interface FlowNodeState {
	/** Money has reached it. */
	reached: boolean;
	/** Money rests there now. */
	holds: boolean;
	/** Its figure (minor units): `null` before money reaches it, or while the amount is unknown. */
	amountMinor: number | null;
	/** Its status line, or `null`. */
	status: string | null;
	/** A second, quieter line ("after the 5% fee"), or `null`. */
	note: string | null;
}

/** Money moving from one place to the next, into the frame that shows it. */
export interface FlowMove {
	from: FlowNode;
	to: FlowNode;
	/** The amount (minor units), or `null` when it is unknown (no fee). */
	amountMinor: number | null;
}

/** The team's side of one payout: clearing for {@link CLEARS_IN_DAYS} days, then withdrawn. */
export type TeamPhase = "unpaid" | "clearing" | "withdrawn";

/** Which half of the stage a step is about. */
export type FlowFocus = "board" | "money";

/** One frame of the flow: everything the stage draws at one step. */
export interface FlowFrame {
	/** 1-based. */
	step: number;
	/** The task as its board card draws it (lane, tag, stage, price). */
	card: DemoCardView;
	/** Its lane. */
	lane: BoardLane;
	/** The board header's "{n} task needs {total} to start" (K8). */
	needs: FundingNeeded;
	/** In Review: the product's review controls show. */
	review: boolean;
	/** Each place's figure and state. */
	nodes: Readonly<Record<FlowNode, FlowNodeState>>;
	/** The moves that brought the money into this frame, in order. */
	moves: readonly FlowMove[];
	/** The fee taken on the stage paid out so far (minor units), or `null`. */
	feeMinor: number | null;
	/** Clearing days passed, 0 to {@link CLEARS_IN_DAYS}; shown once the team is paid. */
	clearedDays: number;
	/** The team has been paid, so the clearing days show. */
	clearing: boolean;
	focus: FlowFocus;
}

/**
 * The client pays for the card's current stage from their wallet: the board holds it as `pay`
 * holds a checkout, and the wallet goes down by exactly the stage's price, with no fee on top (C2).
 * A wallet short of the price pays nothing and is refused, Needs funding.
 */
export function payFromWallet(state: DemoBoardState, cardId: string): DemoBoardState {
	const card = cardById(state, cardId);
	const price = card ? stagePriceMinor(card) : null;
	if (!card || price === null) return reduceBoard(state, pay(cardId));
	if (state.walletMinor < price) {
		return {
			...state,
			last: { kind: "refused", cardId, lane: null, reason: "needs_funding" },
		};
	}
	const next = reduceBoard(state, pay(cardId));
	if (next.last?.kind !== "paid") return next;
	return { ...next, walletMinor: next.walletMinor - next.last.amountMinor };
}

/** The flow's task on `state`, which always holds it. */
function flowCard(state: DemoBoardState): DemoCard {
	const card = cardById(state, FLOW_CARD_ID);
	if (!card) throw new Error(`money-flow: the board has no ${FLOW_CARD_ID}`);
	return card;
}

/** The held place on `state`: the current stage's money, while it is held. */
function heldNode(state: DemoBoardState): FlowNodeState {
	const card = flowCard(state);
	const stage = currentStage(card);
	if (card.escrow !== "held" || !stage) {
		return { reached: false, holds: false, amountMinor: null, status: null, note: null };
	}
	return {
		reached: true,
		holds: true,
		amountMinor: stagePriceMinor(card),
		status: `Stage ${card.stageIndex + 1} · ${stage.name}`,
		note: null,
	};
}

/**
 * The team's and the bank's places for one payout in `phase`. Clearing, the team's place holds the
 * net; withdrawn, a started withdrawal has already taken it out of their wallet, so the team's place
 * is passed through (paid, holding nothing, with no balance status) and the bank holds the net.
 */
function teamNodes(
	payout: DemoPayout | null,
	phase: TeamPhase,
	feeBp: number | null,
): Pick<Record<FlowNode, FlowNodeState>, "team" | "bank"> {
	const none: FlowNodeState = {
		reached: false,
		holds: false,
		amountMinor: null,
		status: null,
		note: null,
	};
	if (!payout || phase === "unpaid") return { team: none, bank: none };
	const note = feeBp === null ? null : FLOW_WORDS.afterFee(formatFeePercent(feeBp));
	if (phase === "clearing") {
		return {
			team: {
				reached: true,
				holds: true,
				amountMinor: payout.netMinor,
				status: FLOW_WORDS.clearing,
				note,
			},
			bank: none,
		};
	}
	return {
		team: { reached: true, holds: false, amountMinor: null, status: null, note: null },
		bank: {
			reached: true,
			holds: true,
			amountMinor: payout.netMinor,
			status: FLOW_WORDS.withdrawal,
			note: null,
		},
	};
}

/** One frame of `state`. */
function frameOf(
	step: number,
	state: DemoBoardState,
	phase: TeamPhase,
	moves: readonly FlowMove[],
	focus: FlowFocus,
): FlowFrame {
	const card = flowCard(state);
	const view = cardView(card);
	const payout = state.payouts.at(-1) ?? null;
	const paidOut = payout !== null && phase !== "unpaid";
	return {
		step,
		card: view,
		lane: view.lane,
		needs: fundingNeeded(state),
		review: view.awaitsApproval,
		nodes: {
			wallet: {
				reached: true,
				holds: true,
				amountMinor: state.walletMinor,
				status: FLOW_WORDS.available,
				note: null,
			},
			held: heldNode(state),
			...teamNodes(payout, phase, state.feeBp),
		},
		moves,
		feeMinor: paidOut ? payout.feeMinor : null,
		clearedDays: phase === "withdrawn" ? CLEARS_IN_DAYS : 0,
		clearing: paidOut,
		focus,
	};
}

/**
 * The flow's six frames, one per step of {@link flowSteps}, run on the board model from
 * {@link FLOW_BOARD} with the server's fee.
 */
export function moneyFlowFrames(feeBp: number | null): FlowFrame[] {
	const found = createBoard(FLOW_BOARD, { feeBp });
	const funded = payFromWallet(found, FLOW_CARD_ID);
	const working = reduceBoard(funded, start(FLOW_CARD_ID, "in_progress"));
	const reviewing = reduceBoard(working, start(FLOW_CARD_ID, "in_review"));
	const approved = reduceBoard(reviewing, approve(FLOW_CARD_ID));

	const firstPrice = stagePriceMinor(flowCard(found));
	const payout = approved.payouts.at(-1) ?? null;
	const next = approved.last?.kind === "approved" ? approved.last.next : null;
	const chained = next?.kind === "chain_held" ? next.amountMinor : null;
	const net = payout?.netMinor ?? null;

	return [
		frameOf(1, found, "unpaid", [], "board"),
		frameOf(
			2,
			funded,
			"unpaid",
			[{ from: "wallet", to: "held", amountMinor: firstPrice }],
			"money",
		),
		frameOf(3, working, "unpaid", [], "board"),
		frameOf(4, reviewing, "unpaid", [], "board"),
		frameOf(
			5,
			approved,
			"clearing",
			[
				{ from: "held", to: "team", amountMinor: net },
				...(chained === null
					? []
					: [{ from: "wallet", to: "held", amountMinor: chained } satisfies FlowMove]),
			],
			"money",
		),
		frameOf(6, approved, "withdrawn", [{ from: "team", to: "bank", amountMinor: net }], "money"),
	];
}
// #endregion

// #region Step spans
/** One value of a per-step sequence and the steps (1-based) that show it. */
export interface StepSpan<T> {
	value: T;
	steps: number[];
}

/**
 * A per-step sequence grouped by value, in order of first appearance: what the sticky stage
 * renders once each, every copy marked with the steps it shows on (`data-mf-on`), so a step change
 * only swaps which copy is visible and nothing reflows.
 */
export function stepSpans<T>(
	values: readonly T[],
	key: (value: T) => string = (value) => JSON.stringify(value) ?? "undefined",
): StepSpan<T>[] {
	const spans = new Map<string, StepSpan<T>>();
	values.forEach((value, index) => {
		const id = key(value);
		const span = spans.get(id);
		if (span) span.steps.push(index + 1);
		else spans.set(id, { value, steps: [index + 1] });
	});
	return [...spans.values()];
}

/** The 1-based steps at which `test` holds for the frame. */
export function stepsWhere(
	frames: readonly FlowFrame[],
	test: (frame: FlowFrame) => boolean,
): number[] {
	return frames.flatMap((frame) => (test(frame) ? [frame.step] : []));
}
// #endregion
