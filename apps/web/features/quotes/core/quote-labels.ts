import type {
	QuoteCardState,
	QuoteEventKind,
	QuoteOfferState,
	QuoteRequestStatus,
	QuoteRole,
	QuoteView,
} from "@projective/types/services";

/**
 * The words the quote surfaces use for a request's state, from the viewer's side. Pure, so the panel,
 * the drawer and their tests read one vocabulary.
 */

/** A request's lifecycle as a status label (a lifecycle status may sit in a container, §3.7). */
export function quoteStatusLabel(status: QuoteRequestStatus, role: QuoteRole): string {
	switch (status) {
		case "sent":
			return role === "host" ? "Needs an offer" : "Awaiting offer";
		case "answered":
			return "Offer sent";
		case "accepted":
			return "Accepted";
		case "declined":
			return "Declined";
		case "withdrawn":
			return "Withdrawn";
	}
}

/** The current offer's state as its heading reads it. */
export function offerStateLabel(state: QuoteOfferState): string {
	switch (state) {
		case "pending":
			return "Open offer";
		case "expired":
			return "Expired offer";
		case "accepted":
			return "Accepted offer";
		case "declined":
			return "Declined offer";
		case "withdrawn":
			return "Withdrawn offer";
	}
}

/**
 * Whether a status renders with the attention tone: it is waiting on this viewer. An accepted offer
 * waits on its buyer to pay until it expires (CK7); past that, nothing they can pay is waiting.
 */
export function waitsOnViewer(quote: QuoteView): boolean {
	if (quote.role === "host") return quote.status === "sent";
	return (quote.status === "answered" && quote.offer?.state === "pending") ||
		(quote.status === "accepted" && !quote.ordered && quote.offer?.state === "accepted");
}

/**
 * The one sentence under an offer about its money, from the viewer's side: how an open or accepted
 * offer is paid, that a lapsed accepted offer can no longer be (the seller's expiry bounds payment,
 * CK7), or that it has been paid for. `null` when there is nothing to say.
 */
export function offerMoneyNote(quote: QuoteView): string | null {
	const state = quote.offer?.state;
	if (quote.ordered) return "Paid for. The engagement is in Projects.";
	if (state === "pending" || state === "accepted") {
		return "Paid into escrow at checkout, and released when the delivery is approved.";
	}
	if (state === "expired" && quote.status === "accepted") {
		return quote.role === "buyer"
			? "This offer lapsed before it was paid. Withdraw the request, then ask again from the listing."
			: "This offer lapsed before the buyer paid for it.";
	}
	return null;
}

/** A calendar date in the viewer's locale, e.g. "2 Dec 2026". */
export function shortDate(at: string, locale?: string): string {
	return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" })
		.format(new Date(at));
}

/** "Delivered in 21 days", singular-aware. */
export function turnaroundLabel(days: number): string {
	return `Delivered in ${days} ${days === 1 ? "day" : "days"}`;
}

/** "2 revisions included", or `null` when the listing does not say. */
export function revisionsLabel(count: number | null): string | null {
	if (count === null) return null;
	if (count === 0) return "No revisions included";
	return `${count} ${count === 1 ? "revision" : "revisions"} included`;
}

/** What a quote card's move was, from the viewer's side. */
export function quoteMoveLabel(kind: QuoteEventKind, mine: boolean): string {
	switch (kind) {
		case "requested":
			return mine ? "You asked for a quote" : "Quote request";
		case "issued":
			return mine ? "You sent a quote" : "Quote received";
		case "offer_sent":
			return mine ? "You sent an offer" : "Offer received";
		case "offer_revised":
			return mine ? "You revised the offer" : "Revised offer";
		case "offer_withdrawn":
			return mine ? "You withdrew the offer" : "Offer withdrawn";
		case "request_declined":
			return mine ? "You declined the request" : "Request declined";
		case "offer_accepted":
			return mine ? "You accepted the offer" : "Offer accepted";
		case "offer_declined":
			return mine ? "You declined the offer" : "Offer declined";
		case "request_withdrawn":
			return mine ? "You withdrew the request" : "Request withdrawn";
		case "paid":
			return mine ? "You paid for the offer" : "Offer paid";
	}
}

/** Where a card's offer stands now, as its status reads. */
export function quoteCardStateLabel(state: QuoteCardState): string {
	switch (state) {
		case "pending":
			return "Open";
		case "accepted":
			return "Accepted";
		case "paid":
			return "Paid";
		case "declined":
			return "Declined";
		case "withdrawn":
			return "Withdrawn";
		case "superseded":
			return "Superseded";
		case "expired":
			return "Expired";
		case "closed":
			return "Closed";
	}
}

/** Whether a card's status waits on this viewer (the attention tone). */
export function cardWaitsOnViewer(state: QuoteCardState | null, role: QuoteRole): boolean {
	return role === "buyer" && (state === "pending" || state === "accepted");
}
