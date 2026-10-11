import type { FundingState, FundingStatus as FundingFacts } from "@projective/types/finance";
import type { BoardCard } from "../types/projects-types.ts";

/**
 * funding-ui — what the funding line SAYS and OFFERS for one ticket, given the state the server derived
 * (`deriveFundingState`, Decision #165). Nothing here decides a state: every function reads
 * {@link FundingFacts} as shipped on `BoardCard.funding` and turns it into copy and a control. Pure,
 * so the sentences are pinned by test (`funding-ui.test.ts`).
 */

// #region Vocabulary
/** Which party the line speaks to — the client pays, the payee starts. */
export type FundingSide = "client" | "provider";

/** The lifecycle label in the status tag (a lifecycle status — §B.11.3's permitted container). */
export const FUNDING_STATE_LABEL: Record<FundingState, string> = {
	draft: "Draft",
	needs_funding: "Needs funding",
	processing: "Processing",
	funded: "Funded",
	in_progress: "In progress",
	in_review: "In review",
	released: "Released",
	failed: "Failed",
	refunded: "Refunded",
};

/** The role each state's tag fills with. Asks-to-act states warn; held money reads as success. */
export const FUNDING_TONE: Record<
	FundingState,
	"neutral" | "warning" | "info" | "success" | "danger"
> = {
	draft: "neutral",
	needs_funding: "warning",
	processing: "info",
	funded: "success",
	in_progress: "info",
	in_review: "info",
	released: "neutral",
	failed: "danger",
	refunded: "neutral",
};

/** States in which the payee must not start — the reason a provider's Start work is disabled. */
const NOT_YET_FUNDED: ReadonlySet<FundingState> = new Set([
	"draft",
	"needs_funding",
	"processing",
	"failed",
]);

/** Whether the client's next act is to pay: a refused hold, or a priced ticket nobody has bought. */
export function asksToFund(f: FundingFacts): boolean {
	return f.state === "needs_funding" || f.nextAction === "fund";
}

/**
 * Paid for ahead of any claim (§3.6 `Draft` with the money in the wallet — #165 reads it as `draft` +
 * `none`): nothing for the client to do, and nothing for a freelancer to start until the claim holds.
 */
export function paidAhead(f: FundingFacts): boolean {
	return f.state === "draft" && f.nextAction === "none";
}

/**
 * The state the TAG names. A described, priced ticket nobody has bought is §3.6 `draft`, but what the
 * client must do about it is fund it — so it reads "Needs funding", and "Draft" keeps meaning what
 * it has always meant on a card: not yet payable.
 */
export function fundingTagState(f: FundingFacts): FundingState {
	return asksToFund(f) ? "needs_funding" : f.state;
}
// #endregion

// #region Copy
/** The facts a sentence reads beyond the funding state — display data off the card, not state. */
export interface FundingLine {
	funding: FundingFacts;
	side: FundingSide;
	/** The payee's name, when someone holds the ticket. */
	freelancer: string | null;
	/** `in_progress`: when work started · `released`: when it paid out. */
	dateLabel: string | null;
	/**
	 * What the escrow pays for. `session` is a seat (Decision #171): it is joined rather than started,
	 * locked at booking and released after the session, so its sentences follow that lifecycle. Absent
	 * reads as `ticket`, so every ticket caller is unchanged.
	 */
	kind?: "ticket" | "session";
	/** A seat's terms, for the session sentences — the platform's own figures. */
	sessionTerms?: { joinLeadMinutes: number; payoutHours: number };
}

/**
 * A seat's sentence through its lifecycle (Decision #171): "Seat reserved, pay to confirm" →
 * "Confirmed, join link opens 10 min before" → "Released 24h after the session".
 */
function sessionSentence(f: FundingFacts, side: FundingSide, terms: { joinLeadMinutes: number; payoutHours: number }): string {
	const amt = f.amountLabel ?? "the full amount";
	const Amt = amt.charAt(0).toUpperCase() + amt.slice(1);
	const lead = `${terms.joinLeadMinutes} min`;
	const after = `${terms.payoutHours}h after the session`;
	if (side === "provider") {
		switch (f.state) {
			case "draft":
			case "needs_funding":
				return "Seat reserved. Waiting for the attendee to pay.";
			case "processing":
				return "The attendee's payment is processing.";
			case "funded":
				return `Confirmed. ${Amt} held until ${after}.`;
			case "in_progress":
				return `Under way. ${Amt} held until ${after}.`;
			case "in_review":
				return `Session ended. ${Amt} releases ${after}.`;
			case "released":
				return `Released ${after}.`;
			case "failed":
				return "The attendee's payment didn't go through.";
			default:
				return "Refunded to the attendee.";
		}
	}
	switch (f.state) {
		case "draft":
		case "needs_funding":
			return "Seat reserved, pay to confirm.";
		case "processing":
			return "Payment processing…";
		case "funded":
			return `Confirmed, join link opens ${lead} before.`;
		case "in_progress":
			return `Confirmed. ${Amt} held until ${after}.`;
		case "in_review":
			return `Session ended. ${Amt} releases ${after} unless you report a no-show.`;
		case "released":
			return `Released ${after}.`;
		case "failed":
			return `Payment didn't go through${
				f.reason ? `: ${f.reason.replace(/\.$/, "")}` : ""
			}. Your seat is still reserved for now.`;
		default:
			return `${Amt} refunded to your wallet.`;
	}
}

/** The one sentence the funding line reads. */
export function fundingSentence(
	{ funding: f, side, freelancer, dateLabel, kind, sessionTerms }: FundingLine,
): string {
	if (kind === "session") {
		return sessionSentence(f, side, sessionTerms ?? { joinLeadMinutes: 10, payoutHours: 24 });
	}
	const amt = f.amountLabel ?? "the full amount";
	const Amt = amt.charAt(0).toUpperCase() + amt.slice(1);
	const who = freelancer ?? "work";
	if (side === "provider") {
		if (NOT_YET_FUNDED.has(f.state)) return "Waiting for the client to fund this. Don't start yet.";
		switch (f.state) {
			case "funded":
				return "Funded. You can start.";
			case "in_progress":
				return `Work started${
					dateLabel ? ` ${dateLabel}` : ""
				}. ${Amt} held until the client approves.`;
			case "in_review":
				return `Delivered. ${Amt} releases when the client approves.`;
			case "released":
				return `Paid ${amt}${dateLabel ? ` on ${dateLabel}` : ""}.`;
			default:
				return "Refunded to the client. Don't continue this work.";
		}
	}
	if (f.state === "draft" && f.nextAction === "describe") {
		return "Add a description to make this payable.";
	}
	if (f.state === "draft" && f.nextAction === "set_price") {
		return "Price this ticket's stages to make it payable.";
	}
	if (asksToFund(f)) return `Fund ${amt} so ${who} can start.`;
	if (paidAhead(f)) return f.reason ?? "Paid for. The escrow is held when a freelancer claims it.";
	switch (f.state) {
		case "draft":
			return "Add a description to make this payable.";
		case "processing":
			return "Payment processing…";
		case "funded": {
			// The From-wallet auto-fund queue held it (PRODUCT_SPEC §Escrow, Wallets & Finance #4).
			const how = f.autoFunded ? `Auto-funded from wallet: ${amt}` : Amt;
			return freelancer
				? `${how} held in escrow. ${freelancer} can start.`
				: `${how} held in escrow, ready for whoever claims it.`;
		}
		case "in_progress":
			return `Work started${dateLabel ? ` ${dateLabel}` : ""}. ${Amt} held until you approve.`;
		case "in_review":
			return `Review the delivery to release ${amt}.`;
		case "released":
			return `Paid ${amt}${dateLabel ? ` on ${dateLabel}` : ""}.${
				f.invoiceOn ? ` Will be invoiced on ${f.invoiceOn}.` : ""
			}`;
		case "failed":
			return `Payment didn't lock${
				f.reason ? `: ${f.reason.replace(/\.$/, "")}` : ""
			}. The money is in your wallet.`;
		default:
			return `${Amt} refunded to your wallet.`;
	}
}

/** The control the line offers. `start-blocked` is Start work rendered disabled with its reason. */
export type FundingAction = "fund" | "review" | "retry" | "start" | "start-blocked" | null;

export function fundingAction(f: FundingFacts, side: FundingSide): FundingAction {
	if (side === "provider") {
		if (f.canStart) return "start";
		return NOT_YET_FUNDED.has(f.state) ? "start-blocked" : null;
	}
	if (asksToFund(f)) return "fund";
	if (f.state === "in_review") return "review";
	if (f.state === "failed") return "retry";
	return null;
}

const SHORT_DATE = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	timeZone: "UTC",
});

/** The date the sentence names, read off the card: the claim for work started, the release for paid. */
export function fundingDateLabel(
	card: Pick<BoardCard, "claimedAt" | "payments">,
	f: FundingFacts,
): string | null {
	if (f.state === "released") {
		return card.payments.find((p) => p.kind === "release" && p.state === "settled")?.dateLabel ??
			null;
	}
	// shortcut: the card stores no separate start instant; the claim is when work could start.
	if (f.state === "in_progress" && card.claimedAt) {
		return SHORT_DATE.format(new Date(card.claimedAt));
	}
	return null;
}
// #endregion

// #region Dev preview
/** The `nextAction` each state carries when the dev switcher forces it — preview only. */
const PREVIEW_ACTION: Record<FundingState, FundingFacts["nextAction"]> = {
	draft: "describe",
	needs_funding: "fund",
	processing: "await_payment",
	funded: "start_work",
	in_progress: "submit",
	in_review: "review",
	released: "none",
	failed: "retry_payment",
	refunded: "none",
};

/**
 * The Dev Context Switcher's forced state over the real facts (amount kept), so each state can be
 * previewed on a real card. Not a derivation: the switcher names the state, this fills its shape.
 */
export function previewFunding(
	f: FundingFacts,
	forced: FundingState | "auto" | undefined,
): FundingFacts {
	if (!forced || forced === "auto") return f;
	return {
		...f,
		state: forced,
		nextAction: PREVIEW_ACTION[forced],
		canStart: forced === "funded",
		reason: forced !== "failed"
			? null
			: f.state === "failed" && f.reason
			? f.reason
			: "Your card was declined.",
	};
}
// #endregion

// #region Board roll-up
/** The board header's "{n} tickets need {total} to start". */
export interface BoardFundingTotal {
	count: number;
	totalMinor: number;
	currency: string | null;
	/** The ids of those tickets, for the basket hand-off. */
	ids: string[];
}

/** Sum the tickets that ask to be funded. An unpriced one counts and adds nothing. */
export function fundingRollup(
	cards: readonly { id: string; funding: FundingFacts | null }[],
): BoardFundingTotal {
	const out: BoardFundingTotal = { count: 0, totalMinor: 0, currency: null, ids: [] };
	for (const c of cards) {
		if (!c.funding || !asksToFund(c.funding)) continue;
		out.count += 1;
		out.totalMinor += c.funding.amountMinor ?? 0;
		out.currency ??= c.funding.currency;
		out.ids.push(c.id);
	}
	return out;
}
// #endregion
