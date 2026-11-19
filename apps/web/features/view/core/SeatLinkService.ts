import type { SeatLinkAction, SeatLinkResult } from "@projective/types/projects";
import { postBooking } from "./api.ts";
import type { BookingResult } from "./respond.ts";

/**
 * SeatLinkService — a multi-seat booking's seat link (Decision #522): the buyer opens or closes it,
 * and anyone holding it claims one seat. Soft results through `/api/services/seats`.
 */
export const SeatLinkService = {
	act(input: SeatLinkAction): Promise<BookingResult<SeatLinkResult>> {
		return postBooking<SeatLinkResult>("/api/services/seats", input);
	},
};

/** The absolute address a seat link's code lands on (`/invite/:token`). */
export function seatLinkHref(code: string, origin: string): string {
	return `${origin.replace(/\/$/, "")}/invite/${code}`;
}
