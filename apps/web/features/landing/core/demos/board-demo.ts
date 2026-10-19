/**
 * board-demo — the demo stage's Work board as words and frames (`flows/LANDING.md` §4.4 Work board,
 * §6 V1; §5 rows K1–K6, C4, D1, D2, E1): what each outcome of the board model says in the host's
 * live region and on the board's status line, the six frames its reduced-motion version steps
 * through, and which lane a phone shows. Pure, over `board-model.ts` and `board-fixtures.ts`, so
 * every sentence is pinned by `board-demo.test.ts`; money is GBP, en-GB (§4 "Placeholders").
 */
// The money slice's formatter, by its own module: the `display/money` barrel also carries MoneyView,
// whose stylesheet import cannot load under `deno test`.
import { formatMoney } from "@ui/display/core/currency-store.ts";
import { platformFeeLabel } from "../demo-stage.ts";
import {
	BOARD_LANES,
	type BoardLane,
	cardById,
	cardView,
	createBoard,
	type DemoBoardState,
	type DemoCardView,
	type DemoFrame,
	type DemoOutcome,
	FUNDING_TAG_LABEL,
	LANE_LABEL,
	pay,
	payoutOf,
	reduceBoard,
	type RefusalReason,
	scriptFrames,
	stagePriceMinor,
} from "./board-model.ts";
import { DEMO_BOARD, DEMO_FOCUS_CARD, DEMO_SCRIPT } from "./board-fixtures.ts";

// #region Copy
/** The Work board's own words (§4.4 "Microcopy"); tagged where a sentence is a claim. */
export const BOARD_DEMO_COPY = {
	kicker: "Work board",
	wallet: "Your wallet",
	dragHint: "Drag a card to try starting it.",
	keyboardHelp:
		"To move a card: Space to pick up, arrow keys to move, Enter to drop, Escape to cancel.",
	pay: "Pay for this stage",
	approve: "Approve and pay",
	moveTo: "Move to…",
	/** `[K3]` */
	refusedFunding: "Needs funding. Pay for this stage before work starts.",
	/** `[K6]` */
	claimRequired: "A freelancer starts this task by claiming it.",
	/** A move the example does not make: the page describing its own board. */
	outsideExample: "Not part of this example.",
	/** `[E1]` */
	teamPaid: "Team paid · clears in 7 days",
	previousLane: "Previous lane",
	nextLane: "Next lane",
	previousStep: "Previous step",
	nextStep: "Next step",
} as const;

/** `amountMinor` as the copy prints it: GBP, en-GB, pence shown ("£1,900.00"). */
export function demoMoney(amountMinor: number, currency = DEMO_BOARD.currency): string {
	return formatMoney(amountMinor, currency, "en-GB");
}

/**
 * A card's price as the product's board card prints it (`formatTicketMoney`, `board.ts`): whole
 * pounds with no pence ("£2,500"), pence only when there are some. The same rule, kept here so the
 * demo's lazy chunk does not load the projects schemas that module sits among; `board-demo.test.ts`
 * pins the two together.
 */
export function ticketMoney(amountMinor: number, currency = DEMO_BOARD.currency): string {
	const whole = amountMinor % 100 === 0;
	return new Intl.NumberFormat("en-GB", {
		style: "currency",
		currency,
		minimumFractionDigits: whole ? 0 : 2,
		maximumFractionDigits: whole ? 0 : 2,
	}).format(amountMinor / 100);
}

/**
 * The accessible name of a card's "Move to…" menu button (the demo's own path where a card cannot be
 * dragged, §2.1 note 12): its visible words first, then the card — "Move to… “Logo v2”" — so the
 * name contains the label a speech-input user reads (WCAG 2.5.3), as "Pay for this stage, “…”" does.
 */
export function moveLabel(title: string): string {
	return `${BOARD_DEMO_COPY.moveTo} “${title}”`;
}

/**
 * A card's accessible name on the live board, where the whole card is one `role="button"` whose
 * face is presentational: its title, then what the face shows — the stage, the funding tag (the
 * demo's story: Needs funding, then Funded) and the price — so focusing the card says it.
 */
export function cardLabel(card: DemoCardView, currency = DEMO_BOARD.currency): string {
	return [
		card.title,
		card.stageName,
		card.tag === null ? null : FUNDING_TAG_LABEL[card.tag],
		card.totalMinor === null ? null : ticketMoney(card.totalMinor, currency),
	].filter((part): part is string => part !== null && part !== "").join(", ");
}

/** "{n} of {total}", the phone's lane pager. */
export function laneCounter(index: number): string {
	return `${index + 1} of ${BOARD_LANES.length}`;
}

/** "Step {n} of {total}" (§4.4 "Controls"). */
export function stepCounter(index: number, total: number): string {
	return `Step ${index + 1} of ${total}`;
}

/** What a lane says while a card it refuses is in flight, for each refusal the board shows early. */
export function refusalText(reason: RefusalReason): string {
	switch (reason) {
		case "needs_funding":
			return BOARD_DEMO_COPY.refusedFunding;
		case "claim_required":
			return BOARD_DEMO_COPY.claimRequired;
		default:
			return BOARD_DEMO_COPY.outsideExample;
	}
}
// #endregion

// #region Money controls
/** Whether the client's checkout for the card's current stage would go through ("Pay for this stage"). */
export function canPay(state: DemoBoardState, cardId: string): boolean {
	return reduceBoard(state, pay(cardId)).last?.kind === "paid";
}

/** Whether the card has a money action now: "Pay for this stage" or "Approve and pay". */
export function hasMoneyAction(state: DemoBoardState, cardId: string): boolean {
	const card = cardById(state, cardId);
	if (!card) return false;
	return cardView(card).awaitsApproval || canPay(state, cardId);
}

/**
 * The one card whose money action is the board's filled (tier 1 amber) control — one filled control
 * per decision region (#288 (E), §B.8.1): the followed task's, while it has one (Pay for this stage,
 * later Approve and pay), else the first card in lane order that has one. Every other money action
 * on the board is drawn tier 4 outlined until it is next. `null` when no card has one.
 */
export function moneyLead(state: DemoBoardState): string | null {
	if (hasMoneyAction(state, DEMO_FOCUS_CARD)) return DEMO_FOCUS_CARD;
	const ordered = [...state.cards].sort((a, b) =>
		BOARD_LANES.indexOf(a.status) - BOARD_LANES.indexOf(b.status)
	);
	return ordered.find((card) => hasMoneyAction(state, card.id))?.id ?? null;
}
// #endregion

// #region Outcomes
/** The board's status line: a refusal, or the "Team paid" moment with what the team receives. */
export type BoardNotice =
	| { kind: "refused"; text: string }
	| { kind: "paid"; text: string; detail: string | null };

/** "Moved “{card}” to {lane}." (§4.4 "Live region"). */
function movedLine(title: string, lane: BoardLane): string {
	return `Moved “${title}” to ${LANE_LABEL[lane]}.`;
}

/**
 * What the host's polite live region says for the board's last outcome (§4.4 "Live region"),
 * `state` being the board after it; `null` when nothing should be said (no outcome, or a reset).
 * An approval also says where Chain Reaction took the task, in the same "Moved …" words.
 */
export function boardAnnouncement(state: DemoBoardState): string | null {
	const outcome = state.last;
	if (!outcome || outcome.kind === "reset" || outcome.kind === "unchanged") return null;
	const card = cardById(state, outcome.cardId);
	if (!card) return null;
	switch (outcome.kind) {
		case "moved":
		case "started":
			return movedLine(card.title, outcome.lane);
		case "refused":
			// `[K3]`
			if (outcome.reason === "needs_funding") {
				return `Can't start “${card.title}” yet. It needs funding first.`;
			}
			return refusalText(outcome.reason);
		case "paid":
			// `[K4]`
			return `Paid for “${card.title}”. It can start now.`;
		case "approved": {
			// `[C4]` `[E1]`
			const paid = outcome.payout.netMinor === null
				? "Approved. The team is paid. It clears in 7 days."
				: `Approved. The team receives ${demoMoney(outcome.payout.netMinor)}. It clears in 7 days.`;
			return `${paid} ${movedLine(card.title, card.status)}`;
		}
	}
}

/**
 * The board's status line for its last outcome: the refusal a lane gave (K3, K6, or a move the
 * example does not make), or the "Team paid · clears in 7 days" moment (E1) with what the team
 * receives after the fee (C4, dropped when the fee is unknown). `null` otherwise.
 */
export function boardNotice(state: DemoBoardState): BoardNotice | null {
	const outcome: DemoOutcome | null = state.last;
	if (outcome?.kind === "refused") return { kind: "refused", text: refusalText(outcome.reason) };
	if (outcome?.kind === "approved") {
		const { netMinor } = outcome.payout;
		return {
			kind: "paid",
			text: BOARD_DEMO_COPY.teamPaid,
			detail: netMinor === null || state.feeBp === null
				? null
				: `The team receives ${demoMoney(netMinor)} after the ${
					platformFeeLabel(state.feeBp)
				} fee.`,
		};
	}
	return null;
}
// #endregion

// #region Frames
/** One frame of the reduced-motion sequence: the board's still and what it says. */
export interface BoardFrameStep {
	frame: DemoFrame;
	/** The frame's caption (§4.4 "Frames"). */
	caption: string;
	/** A second line, or `null`. */
	note: string | null;
	/** The lane a phone shows: the one the followed task stands in. */
	lane: number;
	/** The client's wallet at this frame. */
	walletMinor: number;
}

/**
 * What the host's live region says on reaching a frame: "Step {n} of {total}", the caption, then
 * the frame's second line when it has one, each ending as a sentence.
 */
export function frameAnnouncement(step: BoardFrameStep, index: number, total: number): string {
	return [stepCounter(index, total), step.caption, step.note]
		.filter((part): part is string => part !== null && part !== "")
		.map((part) => (/[.!?]$/.test(part) ? part : `${part}.`))
		.join(" ");
}

/**
 * The six frames of §4.4, picked from the model's frames of {@link DEMO_SCRIPT}: the start, the
 * refused start, the payment, the task in Review (work started, then submitted), the "Team paid"
 * moment and Chain Reaction's move. The fourth frame skips the model's In Progress still, since its
 * caption already says the task went through In Progress.
 */
const FRAME_PICKS = [0, 1, 2, 4, 5, 6] as const;

/**
 * The board state each picked frame shows, as an index into the states the script passes through
 * (the starting board, then one per action): the "Team paid" moment is drawn on the board before
 * the approval moves the task on.
 */
const STATE_PICKS = [0, 1, 2, 4, 4, 5] as const;

/**
 * The Work board's frames with the server's fee: frame 5 names what the team receives after the
 * fee, or only that it is paid when the fee is unknown (§4 "If the fee is unavailable").
 *
 * Frame 1 says the tag the board shows, Needs funding: the board follows the product's tag
 * (`fundingTagState`, Decision #288 (G)), and a described, priced task nobody has paid for reads
 * Needs funding from the start, so frame 2 does not say the tag changes.
 */
export function boardFrames(feeBp: number | null): BoardFrameStep[] {
	const board = createBoard(DEMO_BOARD, { feeBp });
	const frames = scriptFrames(board, DEMO_SCRIPT);
	const states = DEMO_SCRIPT.reduce<DemoBoardState[]>(
		(passed, action) => [...passed, reduceBoard(passed[passed.length - 1], action)],
		[board],
	);
	const focus = cardById(board, DEMO_FOCUS_CARD);
	const gross = focus ? stagePriceMinor(focus) ?? 0 : 0;
	const { netMinor } = payoutOf(gross, feeBp);
	const captions: Array<[string, string | null]> = [
		// `[K2]`
		["“Homepage design” waits in Ready. Its tag says Needs funding.", null],
		// `[K3]`
		["The freelancer tries to start it. Your wallet is short, so the board says no.", null],
		// `[K4]`
		["You pay for the stage. The tag changes to Funded.", null],
		// `[K5]`
		["Work starts. The task moves to In Progress, then Review.", null],
		// `[C4]`
		[
			netMinor === null || feeBp === null
				? "You approve. The team is paid."
				: `You approve. The team receives ${demoMoney(netMinor)} after the ${
					platformFeeLabel(feeBp)
				} fee.`,
			null,
		],
		// `[D1]` `[D2]`
		[
			"The task moves to its next stage, paid for from your wallet.",
			"If your wallet is short, it waits until you pay for it.",
		],
	];
	return FRAME_PICKS.map((pick, index) => {
		const frame = frames[pick];
		const view = frame.cards.find((card) => card.id === DEMO_FOCUS_CARD);
		return {
			frame,
			caption: captions[index][0],
			note: captions[index][1],
			lane: view ? BOARD_LANES.indexOf(view.lane) : 1,
			walletMinor: states[STATE_PICKS[index]].walletMinor,
		};
	});
}
// #endregion
