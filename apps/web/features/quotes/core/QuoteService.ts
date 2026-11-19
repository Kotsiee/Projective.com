import type {
	IssueQuoteInput,
	QuoteActInput,
	QuoteActResult,
	QuoteCardList,
	QuoteList,
	QuotableListingList,
} from "@projective/types/services";
import { getBooking, postBooking } from "@features/view/core/api.ts";
import type { BookingResult } from "@features/view/core/respond.ts";

/**
 * QuoteService — the quotes surfaces' one door to `/api/services/quotes` (Decisions #458, #522). Soft
 * results: a failure is `{ ok: false, message }`, never a thrown error.
 */
export const QuoteService = {
	/** Every quote request between the viewer and the person behind `handle`. */
	listWith(handle: string): Promise<BookingResult<QuoteList>> {
		return getBooking<QuoteList>(`/api/services/quotes?with=${encodeURIComponent(handle)}`);
	},

	/** One act on one request; answers the request as it now stands. */
	act(requestId: string, input: QuoteActInput): Promise<BookingResult<QuoteActResult>> {
		return postBooking<QuoteActResult>(
			`/api/services/quotes/${encodeURIComponent(requestId)}`,
			input,
		);
	},

	/** A seller's own quote for the buyer behind `input.buyer`; answers the request it stands on. */
	issue(input: IssueQuoteInput): Promise<BookingResult<QuoteActResult>> {
		return postBooking<QuoteActResult>("/api/services/quotes", input);
	},

	/** The quote cards for a conversation's quote events. */
	cards(eventIds: readonly string[]): Promise<BookingResult<QuoteCardList>> {
		return getBooking<QuoteCardList>(
			`/api/services/quotes/cards?events=${eventIds.map(encodeURIComponent).join(",")}`,
		);
	},

	/** The services the viewer may quote from a conversation. */
	listings(): Promise<BookingResult<QuotableListingList>> {
		return getBooking<QuotableListingList>("/api/services/quotes/listings");
	},
};
