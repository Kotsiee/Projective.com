/**
 * board-model — the work board as a pure simulation over typed fixtures (`flows/LANDING.md` §4.1
 * hero theatre, §4.4 Work board, §5 rows K1–K8, B3, B4, C4, D1, D2, E1, §6 V1). The hero theatre
 * plays a scripted loop of it; the demo stage's Work board (L3) drives it by hand. It never
 * fetches and never writes: every money figure is integer minor units held in the state.
 *
 * The rules it mirrors, each from the product's own code:
 *
 *   - **Lanes** are the five `ticket_status` lanes (`TICKET_COLUMN_LABEL`, `board.ts`): New · Ready ·
 *     In Progress · Review · Completed; `claimed` folds into In Progress. "Needs funding" is a
 *     funding TAG, never a column (Decision #210 (E)).
 *   - **Funding** is derived the way `deriveFundingState` (`funding-state.ts`) derives it: an
 *     unpriced or undescribed ticket is a Draft that cannot be paid for; a refused hold marks Needs
 *     funding; a held escrow is Funded; a released one is shown as "Team paid" (#283 (b)). The TAG
 *     reads the way the product's card reads it (`fundingTagState`, `funding-ui.ts`): a described,
 *     priced ticket nobody has paid for asks to be funded, so it reads Needs funding, and a card in a
 *     work lane wears no tag, its lane already saying it (`FundingStatus` `COLUMN_SAYS`) — both
 *     pending the owner's ruling, Decision #287 FLAGS (B) and (C).
 *   - **Starting work** is the work-start gate (`fn_ticket_escrow_sync`, `workColumnLocked`): no
 *     hold, no work. A freelancer's start on an unclaimed ticket is the claim, which tries the hold
 *     from the client's live wallet balance and, when it is short, is refused and leaves the ticket
 *     where it was, marked Needs funding (K3). A claimed ticket with no hold is simply refused. A
 *     client cannot start an unclaimed ticket (K6, Decision #206).
 *   - **Paying** is the client's checkout for exactly the stage's price, held as its escrow (K4);
 *     the wallet only funds the holds the product itself takes from it (a claim, Chain Reaction).
 *   - **Approving** a ticket in Review releases its stage: the team receives the price minus
 *     `platformFeeFor(price, feeBp)`, truncated exactly as SQL truncates (C4), clearing in 7 days
 *     (E1). On a non-final stage Chain Reaction moves THE SAME ticket to its next stage and holds
 *     that stage from the live wallet balance when it covers it (D1) — never "the next card"; when
 *     the wallet is short it waits in Ready, marked Needs funding, until the client pays (D2); with
 *     the stage's Chain Reaction switched off it moves on as a Draft with nothing held. On the final
 *     stage the ticket is Completed.
 *
 * Deterministic: no clock, no randomness, so a scripted loop always plays the same frames.
 */
import { platformFeeFor } from "@projective/types/finance";
import type { FundingNextAction, FundingState } from "@projective/types/finance";
import type { TicketColumnStatus } from "@projective/types/projects";

// #region Vocabulary
/** One of the board's five lanes: the `ticket_status` lanes (`claimed` folds into In Progress). */
export type BoardLane = TicketColumnStatus;

/** The lanes, left to right. */
export const BOARD_LANES: readonly BoardLane[] = [
	"backlog",
	"todo",
	"in_progress",
	"in_review",
	"completed",
];

/** Each lane's heading — the product's `TICKET_COLUMN_LABEL` (K1). */
export const LANE_LABEL: Readonly<Record<BoardLane, string>> = {
	backlog: "New",
	todo: "Ready",
	in_progress: "In Progress",
	in_review: "Review",
	completed: "Completed",
};

/** The lanes that are work: entering one from outside them needs a held escrow. */
const WORK_LANES: ReadonlySet<BoardLane> = new Set(["in_progress", "in_review"]);

/**
 * A card's funding tag: the product's funding states (`FundingState`, the tags §6 V1 mirrors), with a
 * released escrow shown as "Team paid" (#283 (b)).
 */
export type FundingTag = Exclude<FundingState, "released"> | "team_paid";

/** Each tag's text: the product's `FUNDING_STATE_LABEL`, a released escrow reading "Team paid" (#283 (b)). */
export const FUNDING_TAG_LABEL: Readonly<Record<FundingTag, string>> = {
	draft: "Draft",
	needs_funding: "Needs funding",
	processing: "Processing",
	funded: "Funded",
	in_progress: "In progress",
	in_review: "In review",
	team_paid: "Team paid",
	failed: "Failed",
	refunded: "Refunded",
};

/** A tag's role tone. */
export type FundingTagTone = "neutral" | "warning" | "info" | "success" | "danger";

/** Each tag's role tone, as the product's `FUNDING_TONE` assigns it. */
export const FUNDING_TAG_TONE: Readonly<Record<FundingTag, FundingTagTone>> = {
	draft: "neutral",
	needs_funding: "warning",
	processing: "info",
	funded: "success",
	in_progress: "info",
	in_review: "info",
	team_paid: "neutral",
	failed: "danger",
	refunded: "neutral",
};

/**
 * Tags a board card leaves to its lane, as the product's card does (`FundingStatus` `COLUMN_SAYS`);
 * "Team paid" stays, the one release moment the theatre shows (#283 (b)).
 */
const LANE_SAYS: ReadonlySet<FundingTag> = new Set(["in_progress", "in_review"]);

/** Days a payout stays pending before it can be withdrawn (`pending_release_days`, E1). */
export const CLEARS_IN_DAYS = 7;
// #endregion

// #region Shapes
/** One stage a ticket requires, in the ticket's own order. */
export interface DemoStage {
	id: string;
	name: string;
	/** What the stage costs this ticket (minor units); `null` while it is unpriced. */
	priceMinor: number | null;
	/** "Fund on arrival" (`project_stages.chain_reaction`, on by default). */
	chainReaction: boolean;
}

/** The person a ticket is assigned to. */
export interface DemoParty {
	name: string;
	avatar: string | null;
}

/** The current stage's escrow: nothing held, held, or released to the team. */
export type DemoEscrow = "none" | "held" | "released";

/** One ticket on the board. */
export interface DemoCard {
	id: string;
	title: string;
	/** The purchasing gate: a ticket without a description can be neither paid for nor claimed. */
	described: boolean;
	stages: readonly DemoStage[];
	/** Which of {@link stages} the ticket stands on. */
	stageIndex: number;
	/** Its `ticket_status`, folded to its lane. */
	status: BoardLane;
	/** A freelancer holds the ticket. */
	claimed: boolean;
	escrow: DemoEscrow;
	/** A refused hold marked it Needs funding (`projects.fn_mark_needs_funding`). */
	needsFunding: boolean;
	assignee: DemoParty | null;
}

/** A board as a fixture describes it. */
export interface DemoBoardFixture {
	title: string;
	/** ISO 4217; every amount on the board is in it. */
	currency: string;
	/** The client's spendable wallet balance (minor units). */
	walletMinor: number;
	cards: readonly DemoCard[];
}

/** The server's facts the board needs. */
export interface DemoBoardConfig {
	/**
	 * The platform fee in basis points (`platform_fee_bp`, from the server); `null` when it is
	 * unavailable, and then every payout's fee and net are unknown and their clauses are dropped.
	 */
	feeBp: number | null;
}

/** One stage paid out to the team. */
export interface DemoPayout {
	cardId: string;
	stageId: string;
	/** The stage's price: what the client paid and the escrow held. */
	grossMinor: number;
	/** `platformFeeFor(gross, feeBp)`, or `null` when the fee is unknown. */
	feeMinor: number | null;
	/** What the team receives, or `null` when the fee is unknown. */
	netMinor: number | null;
	/** It clears after this many days. */
	clearsInDays: number;
}

/** Why a move or a payment was refused. */
export type RefusalReason =
	/** No hold, no work: pay for this stage first (K3). */
	| "needs_funding"
	/** A client cannot start an unclaimed ticket: a freelancer starts it by claiming it (K6). */
	| "claim_required"
	/** Unpriced or undescribed: a Draft can be neither paid for nor claimed. */
	| "not_payable"
	/** Only approving a ticket in Review completes it. */
	| "approve_required"
	/** Work enters Review from In Progress, not from outside work. */
	| "start_first"
	/** Approval needs a ticket in Review. */
	| "not_in_review"
	/** Work under way, or finished, does not move back out of work. */
	| "locked";

/** Where Chain Reaction left an approved ticket. */
export type ChainOutcome =
	/** Its final stage: Completed. */
	| { kind: "completed" }
	/** On to its next stage, held from the wallet (D1). */
	| { kind: "chain_held"; stageId: string; amountMinor: number }
	/** On to its next stage, waiting for payment: the wallet was short (D2). */
	| { kind: "chain_needs_funding"; stageId: string; amountMinor: number | null }
	/** On to its next stage as a Draft: Chain Reaction is off there. */
	| { kind: "chain_off"; stageId: string };

/** What the last action did — what a live region announces and a theatre animates. */
export type DemoOutcome =
	| { kind: "moved"; cardId: string; lane: BoardLane }
	| { kind: "started"; cardId: string; lane: BoardLane; heldFrom: "escrow" | "wallet" }
	| { kind: "refused"; cardId: string; lane: BoardLane | null; reason: RefusalReason }
	| { kind: "paid"; cardId: string; amountMinor: number }
	| { kind: "approved"; cardId: string; payout: DemoPayout; next: ChainOutcome }
	| { kind: "unchanged"; cardId: string }
	| { kind: "reset" };

/** The whole simulation. */
export interface DemoBoardState {
	title: string;
	currency: string;
	feeBp: number | null;
	walletMinor: number;
	cards: readonly DemoCard[];
	/** Every stage paid out so far, oldest first. */
	payouts: readonly DemoPayout[];
	last: DemoOutcome | null;
	/** The fixture it started from, for {@link reset}. */
	origin: DemoBoardFixture;
}

/** Everything the board can be asked to do. */
export type BoardAction =
	| { type: "start"; cardId: string; lane: BoardLane; by: "freelancer" | "client" }
	| { type: "pay"; cardId: string }
	| { type: "approve"; cardId: string }
	| { type: "reset" };
// #endregion

// #region Actions
/**
 * Move a card into `lane` — a drag or a keyboard drop. By default the freelancer moves it (entering
 * work from outside it is their claim); pass `"client"` for the client's own drag.
 */
export function start(
	cardId: string,
	lane: BoardLane,
	by: "freelancer" | "client" = "freelancer",
): BoardAction {
	return { type: "start", cardId, lane, by };
}

/** The client pays for the card's current stage. */
export function pay(cardId: string): BoardAction {
	return { type: "pay", cardId };
}

/** The client approves the card's work in Review: "Approve and pay". */
export function approve(cardId: string): BoardAction {
	return { type: "approve", cardId };
}

/** Back to the fixture: "Start again". */
export function reset(): BoardAction {
	return { type: "reset" };
}
// #endregion

// #region Card facts
/** The stage the card stands on, or `null` past its last. */
export function currentStage(card: DemoCard): DemoStage | null {
	return card.stages[card.stageIndex] ?? null;
}

/** What its current stage costs, or `null` while unpriced. */
export function stagePriceMinor(card: DemoCard): number | null {
	const price = currentStage(card)?.priceMinor ?? null;
	return price !== null && price > 0 ? price : null;
}

/**
 * The card's price as the board card shows it — the sum of its priced stages (`budgetCents`), or
 * `null` when none is priced.
 */
export function cardTotalMinor(card: DemoCard): number | null {
	const priced = card.stages.flatMap((stage) =>
		stage.priceMinor !== null && stage.priceMinor > 0 ? [stage.priceMinor] : []
	);
	return priced.length === 0 ? null : priced.reduce((sum, price) => sum + price, 0);
}

/** The card's funding, derived as `deriveFundingState` derives it. */
export interface DemoFunding {
	state: FundingState;
	nextAction: FundingNextAction;
	/** Work may start: only when Funded. */
	canStart: boolean;
	amountMinor: number | null;
}

/** The card's {@link DemoFunding}. */
export function fundingOf(card: DemoCard): DemoFunding {
	const amountMinor = stagePriceMinor(card);
	const status = (state: FundingState, nextAction: FundingNextAction): DemoFunding => ({
		state,
		nextAction,
		canStart: state === "funded",
		amountMinor,
	});
	if (card.escrow === "released") return status("released", "none");
	if (card.escrow === "held") {
		if (card.status === "in_review") return status("in_review", "review");
		if (card.status === "in_progress") return status("in_progress", "submit");
		if (card.status === "completed") return status("released", "none");
		return status("funded", "start_work");
	}
	if (card.status === "completed") return status("draft", "none");
	const fundAction: FundingNextAction = amountMinor === null ? "set_price" : "fund";
	if (card.needsFunding || WORK_LANES.has(card.status)) return status("needs_funding", fundAction);
	if (!card.described) return status("draft", "describe");
	return status("draft", fundAction);
}

/**
 * The card's funding tag, read the way the product's `fundingTagState` reads it: a card that asks
 * to be paid for is Needs funding (a described, priced ticket nobody has bought included), a released
 * escrow is "Team paid", and anything else is its state. So the tag and the header's count
 * ({@link fundingNeeded}) always agree.
 */
export function fundingTagOf(card: DemoCard): FundingTag {
	const funding = fundingOf(card);
	if (funding.state === "released") return "team_paid";
	if (asksToFund(card)) return "needs_funding";
	return funding.state;
}

/** Whether the card asks the client to pay — the product's `asksToFund`. */
export function asksToFund(card: DemoCard): boolean {
	const funding = fundingOf(card);
	return funding.state === "needs_funding" || funding.nextAction === "fund";
}

/** The board header's "{n} tasks need {total} to start" (the product's `fundingRollup`, K8). */
export interface FundingNeeded {
	count: number;
	totalMinor: number;
	/** The cards it counts, for "Fund all". */
	ids: string[];
}

/** The board's {@link FundingNeeded}: every card that asks to be paid for; an unpriced one adds nothing. */
export function fundingNeeded(state: Pick<DemoBoardState, "cards">): FundingNeeded {
	const out: FundingNeeded = { count: 0, totalMinor: 0, ids: [] };
	for (const card of state.cards) {
		if (!asksToFund(card)) continue;
		out.count += 1;
		out.totalMinor += stagePriceMinor(card) ?? 0;
		out.ids.push(card.id);
	}
	return out;
}

/** The fee and the team's net on `grossMinor`, or `null`s when the fee is unknown. */
export function payoutOf(
	grossMinor: number,
	feeBp: number | null,
): { feeMinor: number | null; netMinor: number | null } {
	if (feeBp === null) return { feeMinor: null, netMinor: null };
	const feeMinor = platformFeeFor(grossMinor, feeBp);
	return { feeMinor, netMinor: grossMinor - feeMinor };
}
// #endregion

// #region Board
/** A fresh board over `fixture`. */
export function createBoard(fixture: DemoBoardFixture, config: DemoBoardConfig): DemoBoardState {
	return {
		title: fixture.title,
		currency: fixture.currency,
		feeBp: config.feeBp,
		walletMinor: fixture.walletMinor,
		cards: fixture.cards,
		payouts: [],
		last: null,
		origin: fixture,
	};
}

/** The card with `cardId`, or `undefined`. */
export function cardById(state: DemoBoardState, cardId: string): DemoCard | undefined {
	return state.cards.find((card) => card.id === cardId);
}

/** `state` with one card replaced and the rest of it patched. */
function withCard(
	state: DemoBoardState,
	card: DemoCard,
	patch: Partial<Omit<DemoBoardState, "cards">>,
): DemoBoardState {
	return {
		...state,
		...patch,
		cards: state.cards.map((c) => (c.id === card.id ? card : c)),
	};
}

/** `state` with only its last outcome changed. */
function said(state: DemoBoardState, last: DemoOutcome): DemoBoardState {
	return { ...state, last };
}

/** A move into a lane: the planning moves, the gate into work, and the moves inside it. */
function reduceStart(
	state: DemoBoardState,
	card: DemoCard,
	lane: BoardLane,
	by: "freelancer" | "client",
): DemoBoardState {
	const refuse = (reason: RefusalReason) =>
		said(state, { kind: "refused", cardId: card.id, lane, reason });
	if (lane === card.status) return said(state, { kind: "unchanged", cardId: card.id });
	if (lane === "completed") return refuse("approve_required");
	if (card.status === "completed") return refuse("locked");

	const inWork = WORK_LANES.has(card.status);
	if (!WORK_LANES.has(lane)) {
		if (inWork) return refuse("locked");
		return withCard(state, { ...card, status: lane }, {
			last: { kind: "moved", cardId: card.id, lane },
		});
	}
	if (inWork) {
		// In Progress ⇄ Review: a submission or a revision, never an entry into work.
		return withCard(state, { ...card, status: lane }, {
			last: { kind: "moved", cardId: card.id, lane },
		});
	}
	if (lane === "in_review") return refuse("start_first");
	if (!card.claimed && by === "client") return refuse("claim_required");

	const price = stagePriceMinor(card);
	if (!card.described || price === null) return refuse("not_payable");
	const started = (next: DemoCard, heldFrom: "escrow" | "wallet", walletMinor: number) =>
		withCard(state, next, {
			walletMinor,
			last: { kind: "started", cardId: card.id, lane, heldFrom },
		});
	if (card.escrow === "held") {
		return started({ ...card, status: lane, claimed: true }, "escrow", state.walletMinor);
	}
	if (card.claimed) return refuse("needs_funding");
	// The claim is the hold: from the client's live wallet balance, or refused.
	if (state.walletMinor >= price) {
		return started(
			{ ...card, status: lane, claimed: true, escrow: "held", needsFunding: false },
			"wallet",
			state.walletMinor - price,
		);
	}
	return withCard(state, { ...card, needsFunding: true }, {
		last: { kind: "refused", cardId: card.id, lane, reason: "needs_funding" },
	});
}

/** The client's checkout for exactly the current stage's price, held as its escrow. */
function reducePay(state: DemoBoardState, card: DemoCard): DemoBoardState {
	const price = stagePriceMinor(card);
	if (!card.described || price === null) {
		return said(state, { kind: "refused", cardId: card.id, lane: null, reason: "not_payable" });
	}
	if (card.escrow !== "none" || card.status === "completed") {
		return said(state, { kind: "unchanged", cardId: card.id });
	}
	return withCard(state, { ...card, escrow: "held", needsFunding: false }, {
		last: { kind: "paid", cardId: card.id, amountMinor: price },
	});
}

/** Approve and pay: release the stage to the team, then Chain Reaction. */
function reduceApprove(state: DemoBoardState, card: DemoCard): DemoBoardState {
	const stage = currentStage(card);
	const price = stagePriceMinor(card);
	if (card.status !== "in_review" || card.escrow !== "held" || !stage || price === null) {
		return said(state, { kind: "refused", cardId: card.id, lane: null, reason: "not_in_review" });
	}
	const payout: DemoPayout = {
		cardId: card.id,
		stageId: stage.id,
		grossMinor: price,
		...payoutOf(price, state.feeBp),
		clearsInDays: CLEARS_IN_DAYS,
	};
	const payouts = [...state.payouts, payout];
	const nextIndex = card.stageIndex + 1;
	const nextStage = card.stages[nextIndex];

	if (!nextStage) {
		return withCard(state, { ...card, status: "completed", escrow: "released" }, {
			payouts,
			last: { kind: "approved", cardId: card.id, payout, next: { kind: "completed" } },
		});
	}
	const moved = { ...card, stageIndex: nextIndex };
	const nextPrice = stagePriceMinor(moved);
	if (!nextStage.chainReaction) {
		return withCard(state, { ...moved, status: "todo", escrow: "none", needsFunding: false }, {
			payouts,
			last: {
				kind: "approved",
				cardId: card.id,
				payout,
				next: { kind: "chain_off", stageId: nextStage.id },
			},
		});
	}
	if (nextPrice !== null && state.walletMinor >= nextPrice) {
		return withCard(
			state,
			{ ...moved, status: "in_progress", escrow: "held", needsFunding: false },
			{
				payouts,
				walletMinor: state.walletMinor - nextPrice,
				last: {
					kind: "approved",
					cardId: card.id,
					payout,
					next: { kind: "chain_held", stageId: nextStage.id, amountMinor: nextPrice },
				},
			},
		);
	}
	return withCard(state, { ...moved, status: "todo", escrow: "none", needsFunding: true }, {
		payouts,
		last: {
			kind: "approved",
			cardId: card.id,
			payout,
			next: { kind: "chain_needs_funding", stageId: nextStage.id, amountMinor: nextPrice },
		},
	});
}

/** The board after `action`. Pure: `state` is never changed, and the same inputs give the same board. */
export function reduceBoard(state: DemoBoardState, action: BoardAction): DemoBoardState {
	if (action.type === "reset") {
		return { ...createBoard(state.origin, { feeBp: state.feeBp }), last: { kind: "reset" } };
	}
	const card = cardById(state, action.cardId);
	if (!card) return state;
	switch (action.type) {
		case "start":
			return reduceStart(state, card, action.lane, action.by);
		case "pay":
			return reducePay(state, card);
		case "approve":
			return reduceApprove(state, card);
	}
}
// #endregion

// #region Frames
/** One card as a frame draws it. */
export interface DemoCardView {
	id: string;
	title: string;
	lane: BoardLane;
	/** The stage it stands on. */
	stageName: string | null;
	/** {@link cardTotalMinor}. */
	totalMinor: number | null;
	/**
	 * Its tag; `null` in a work lane, which says it already, and while it waits on the client's
	 * approval, which its control says instead.
	 */
	tag: FundingTag | null;
	/** In Review: the client's control is "Approve and pay". */
	awaitsApproval: boolean;
	assignee: DemoParty | null;
}

/** What a frame calls attention to: the card an action just changed, and how. */
export interface DemoBeat {
	cardId: string;
	kind: "team_paid" | "moved" | "started" | "refused" | "paid" | "unchanged";
}

/** One still of the board. */
export interface DemoFrame {
	cards: DemoCardView[];
	needs: FundingNeeded;
	beat: DemoBeat | null;
}

/** A card's {@link DemoCardView}. */
export function cardView(card: DemoCard): DemoCardView {
	const awaitsApproval = card.status === "in_review" && card.escrow === "held";
	const tag = fundingTagOf(card);
	return {
		id: card.id,
		title: card.title,
		lane: card.status,
		stageName: currentStage(card)?.name ?? null,
		totalMinor: cardTotalMinor(card),
		tag: awaitsApproval || LANE_SAYS.has(tag) ? null : tag,
		awaitsApproval,
		assignee: card.assignee,
	};
}

/** The frame of `state`; `paid` names a card shown at its "Team paid" moment, before it moves on. */
function frameOf(state: DemoBoardState, beat: DemoBeat | null, paid?: string): DemoFrame {
	return {
		cards: state.cards.map((card) => {
			const view = cardView(card);
			return card.id === paid ? { ...view, tag: "team_paid", awaitsApproval: false } : view;
		}),
		needs: fundingNeeded(state),
		beat,
	};
}

/**
 * The frames a scripted loop plays: the starting board, then one frame per action — two for an
 * approval, which first shows the card "Team paid" where it stands and then where Chain Reaction
 * takes it. The hero theatre steps through these on its turns; a reduced-motion stage can show them
 * one at a time.
 */
export function scriptFrames(initial: DemoBoardState, script: readonly BoardAction[]): DemoFrame[] {
	const frames: DemoFrame[] = [frameOf(initial, null)];
	let state = initial;
	for (const action of script) {
		const next = reduceBoard(state, action);
		const outcome = next.last;
		if (outcome?.kind === "approved") {
			frames.push(frameOf(state, { cardId: outcome.cardId, kind: "team_paid" }, outcome.cardId));
			frames.push(frameOf(next, { cardId: outcome.cardId, kind: "moved" }));
		} else if (outcome && outcome.kind !== "reset") {
			frames.push(frameOf(next, { cardId: outcome.cardId, kind: outcome.kind }));
		} else {
			frames.push(frameOf(next, null));
		}
		state = next;
	}
	return frames;
}
// #endregion
