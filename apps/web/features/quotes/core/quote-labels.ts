import type {
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

/** Whether a status renders with the attention tone: it is waiting on this viewer. */
export function waitsOnViewer(quote: QuoteView): boolean {
	if (quote.role === "host") return quote.status === "sent";
	return (quote.status === "answered" && quote.offer?.state === "pending") ||
		(quote.status === "accepted" && !quote.ordered);
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
