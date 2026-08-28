import { NOW } from "../scheduling/derive.ts";

/**
 * custom-quote store — the in-module session store behind the Contact menu's "Request a custom
 * quote".
 *
 * A quote request is a top-of-funnel record: it creates no project, no stage, no ticket and no
 * escrow, and it never enters the delivery state machine. It is a message with structure — a scope, a
 * soft budget, a rough timeline — attached to the service blueprint it was asked about, so the
 * provider can answer it with a real price.
 *
 * **The budget is stored as SOFT and named as such.** A service's price is provider-set
 * (`PRODUCT_SPEC.md` §Why Sessions are Fixed), so this is "here is what I have in mind", never a
 * counter-offer. Modelling it as a negotiable price would invite a haggling flow the platform does
 * not have and does not want.
 *
 * Per-process and unpersisted. The live path replaces this file with an insert into the quote ledger
 * (a Phase-2 table) plus a `comms` notification to the provider; the shape the service returns is
 * unchanged either side of that.
 */

// #region Rows
/** One recorded proposal. */
export interface QuoteRow {
	id: string;
	/** The provider it was sent to, without the `@`. */
	handle: string;
	requesterId: string;
	/** The service blueprint it was asked against. */
	subjectId: string;
	scope: string;
	/** Integer minor units, or `null` when the buyer did not name a figure. */
	budgetMinor: number | null;
	/** ISO-4217. Always present when `budgetMinor` is — an amount is never quoted currency-less. */
	currency: string | null;
	/** Free text ("mid-March", "before our launch"). Never parsed into a date. */
	timeline: string | null;
	/**
	 * Where the proposal is.
	 *
	 * Three states and no more: it has been sent, the provider has answered it, or it has been
	 * withdrawn. Nothing is hard-deleted (root CLAUDE.md §7), so a withdrawn proposal is a status
	 * rather than a missing row.
	 */
	status: "sent" | "answered" | "withdrawn";
	createdAt: number;
}

const quotes = new Map<string, QuoteRow>();
// #endregion

// #region Writes
/** What the service supplies to record a proposal. */
export interface QuoteSeed {
	handle: string;
	requesterId: string;
	subjectId: string;
	scope: string;
	budgetMinor: number | null;
	currency: string | null;
	timeline: string | null;
	now?: number;
}

/**
 * Record a proposal.
 *
 * Unlike a booking this is deliberately NOT idempotent on its content: a buyer who sends two
 * proposals for one service is describing two different pieces of work, and collapsing them would
 * silently discard the second. The id is therefore sequence-based rather than derived from the
 * request, which is exactly the opposite call from the call store's — and the difference is the
 * point. A double-booked calendar slot is a defect; a second proposal is a message.
 */
export function recordQuote(seed: QuoteSeed): QuoteRow {
	const now = seed.now ?? NOW;
	const row: QuoteRow = {
		id: `quote-${quotes.size + 1}-${seed.subjectId}`,
		handle: seed.handle,
		requesterId: seed.requesterId,
		subjectId: seed.subjectId,
		scope: seed.scope,
		budgetMinor: seed.budgetMinor,
		currency: seed.currency,
		timeline: seed.timeline,
		status: "sent",
		createdAt: now,
	};
	quotes.set(row.id, row);
	return row;
}
// #endregion

// #region Reads
/** Every proposal this requester has sent about this listing, newest first. */
export function listQuotes(subjectId: string, requesterId: string): QuoteRow[] {
	return [...quotes.values()]
		.filter((q) => q.subjectId === subjectId && q.requesterId === requesterId)
		.sort((a, b) => b.createdAt - a.createdAt);
}
// #endregion
