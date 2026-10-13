import {
	formatMoney,
	type StageFundingQuote,
	unpricedTicketsSentence,
} from "@projective/types/finance";

/**
 * stage-funding — the pure model behind "Fund stage" (Decision #197): which ways the payer may fund a
 * stage from its server quote, and what to say about each outcome. No DOM, no fetch, so it is tested
 * on its own and the wallet dialog and the board's FundStageDialog cannot word one fact two ways.
 */

// #region Plan
/** How a stage is paid for: held from the paying wallet, or charged to a card that tops it up first. */
export type StageFundMethod = "wallet" | "card";

/** What the dialog offers for one quote. */
export interface StageFundingPlan {
	/** Why nothing can be funded right now; `null` when the stage can be funded. */
	blocked: string | null;
	/** The methods on offer, best first; empty when blocked. */
	methods: StageFundMethod[];
	amountLabel: string;
	/** "Business wallet · $1,200.00 available" — the wallet the escrow is held from. */
	walletLabel: string;
	/** "3 tickets at their agreed prices". */
	ticketsLine: string;
}

/**
 * The plan for a quote. The wallet is offered only when it covers the whole stage — `fund_stage` is
 * all or nothing — and the card always, since a card payment tops the same wallet up and the webhook
 * then holds the stage from it.
 */
export function stageFundingPlan(quote: StageFundingQuote): StageFundingPlan {
	const blocked = !quote.fundable
		? "This stage has finished, so nothing more can be funded."
		: quote.unpricedCount > 0
		? unpricedTicketsSentence(quote.unpricedCount)
		: quote.amountMinor <= 0
		? "Nothing in this stage is waiting for funding."
		: null;
	const covers = quote.walletBalanceMinor >= quote.amountMinor;
	const methods: StageFundMethod[] = blocked ? [] : covers ? ["wallet", "card"] : ["card"];
	return {
		blocked,
		methods,
		amountLabel: formatMoney(quote.amountMinor, quote.currency),
		walletLabel: `${quote.payer.scope === "business" ? "Business wallet" : "Your wallet"} · ${
			formatMoney(Math.max(0, quote.walletBalanceMinor), quote.currency)
		} available`,
		ticketsLine: `${quote.ticketCount} ${
			quote.ticketCount === 1 ? "ticket" : "tickets"
		} at their agreed prices`,
	};
}
// #endregion

// #region Outcomes
/**
 * Where a card payment for a stage ended up: `locked` (escrow held), `declined` (the card was not
 * charged), `lock_failed` (the money arrived but the stage refused it — it stays in the wallet) or
 * `timeout` (the bank accepted it; the webhook has not settled it yet).
 */
export type StageLockOutcome = "locked" | "declined" | "lock_failed" | "timeout";

/** The one sentence a surface shows for a stage-funding outcome. */
export function stageLockSentence(outcome: StageLockOutcome, reason: string | null = null): string {
	switch (outcome) {
		case "locked":
			return "The stage is funded. Its escrow is held until you approve the work.";
		case "declined":
			return reason
				? `The payment didn't go through: ${reason.replace(/\.$/, "")}. Nothing was charged.`
				: "The payment didn't go through. Nothing was charged.";
		case "lock_failed":
			return `The payment arrived but the stage couldn't be funded${
				reason ? `: ${reason.replace(/\.$/, "")}` : ""
			}. The money is in your wallet.`;
		default:
			return "Your bank accepted the payment. The stage is funded as soon as it clears.";
	}
}
// #endregion
