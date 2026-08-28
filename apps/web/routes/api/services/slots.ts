import { define } from "@web/utils/state.ts";
import { SlotQuerySchema } from "@projective/types/scheduling";
import { serviceSimFromParams } from "@projective/types/services";
import { BookingBackendService } from "@server/services/booking/BookingBackendService.ts";
import { invalidPayload, toBookingResponse } from "@features/view/core/respond.ts";

/**
 * `GET /api/services/slots?subjectId=&purpose=&timezone=&from=&days=` — the bookable slot grid behind
 * the date rail and the slot picker.
 *
 * Thin: coerce the query into {@link SlotQuerySchema}, then delegate. The listing's own booking
 * parameters — slot length, block size, seat cap — are resolved SERVER-side from the service view and
 * are deliberately not accepted here: a picker that took its duration from a query param would offer
 * whatever length the URL asked for.
 *
 * **`timezone` is the one caller-supplied field that matters, and it is safe.** It decides which
 * calendar days the grid is bucketed into, nothing more — a caller who sends a zone they do not live
 * in gets a grid drawn in that zone, which is a strange thing to do to oneself rather than a way to
 * see anything withheld. The grid discloses only that a time is free or spoken for, never who has it.
 *
 * Guest-reachable, like the schedule read it projects: a visitor may see when a provider is free
 * before deciding to sign up. Booking one is what requires an account.
 */
export const handler = define.handlers({
	GET(ctx) {
		const p = ctx.url.searchParams;
		const parsed = SlotQuerySchema.safeParse({
			subjectId: p.get("subjectId") ?? "",
			purpose: p.get("purpose") ?? "session",
			timezone: p.get("timezone") ?? undefined,
			// `Number(null)` is 0, not NaN — so the presence check has to come first or an absent `from`
			// would pin the rail to 1970 rather than falling through to the notice floor.
			from: p.get("from") ? Number(p.get("from")) : undefined,
			days: p.get("days") ? Number(p.get("days")) : undefined,
		});
		if (!parsed.success) return invalidPayload(parsed.error);

		return toBookingResponse(
			BookingBackendService.slots(parsed.data, serviceSimFromParams(p)),
		);
	},
});
