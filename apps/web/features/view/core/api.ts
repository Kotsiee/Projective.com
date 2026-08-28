import { apiFetch } from "@web/utils/api-client.ts";
import type { BookingResult } from "./respond.ts";

/**
 * Booking transport primitives — the `fetch` helpers {@link BookingService} composes over.
 *
 * Any network or parse failure degrades to a soft `{ ok: false, message }` rather than throwing, so
 * the islands stay dumb: a booking modal renders the sentence it is handed and never has to decide
 * what a rejected promise means. Mirrors `explore/core/api.ts` and `projects/core/api.ts`.
 *
 * Requests ride {@link apiFetch}, so an expired access token on a write is silently refreshed and
 * retried rather than surfacing as a bare failure — which matters more here than on a read: a buyer
 * who has been reading a listing for twenty minutes and then presses Book is exactly the person whose
 * token has just lapsed.
 */

/** GET a booking endpoint, folding the response into a soft {@link BookingResult}. */
export async function getBooking<T>(path: string): Promise<BookingResult<T>> {
	try {
		const res = await apiFetch(path, { headers: { accept: "application/json" } });
		const body = await res.json().catch(() => null);
		if (body && typeof body.ok === "boolean") return body as BookingResult<T>;
		return { ok: false, message: "Unexpected response from the booking service." };
	} catch {
		return { ok: false, message: "Network error — please try again." };
	}
}

/** POST JSON to a booking endpoint, folding the response into a soft {@link BookingResult}. */
export async function postBooking<T>(path: string, payload: unknown): Promise<BookingResult<T>> {
	try {
		const res = await apiFetch(path, {
			method: "POST",
			headers: { "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify(payload),
		});
		const body = await res.json().catch(() => null);
		if (body && typeof body.ok === "boolean") return body as BookingResult<T>;
		return { ok: false, message: "Unexpected response from the booking service." };
	} catch {
		return { ok: false, message: "Network error — please try again." };
	}
}
