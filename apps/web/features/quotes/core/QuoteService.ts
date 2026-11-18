import type { QuoteActInput, QuoteActResult, QuoteList } from "@projective/types/services";
import { getBooking, postBooking } from "@features/view/core/api.ts";
import type { BookingResult } from "@features/view/core/respond.ts";

/**
 * QuoteService — the quotes surfaces' one door to `/api/services/quotes` (Decision #458). Soft
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
};
