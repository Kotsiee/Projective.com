import {
	DEFAULT_WAITLIST_INVITE_HOLD_HOURS,
	seatCount,
	type ViewerWaitlistPlace,
} from "@projective/types/projects";
import { resolveCta, type ServiceBookingOffer } from "@projective/types/services";

/** The waitlist place the Dev Context Switcher previews; `auto` leaves the server's offer alone. */
export type WaitlistPreview = "auto" | "waiting" | "invited" | "expired";

const HOUR = 3_600_000;

/**
 * The offer as a viewer in `state` would see it (Decision #455): a full cohort with them waiting at
 * number 3, holding an invited seat, or with their invite lapsed. Only a group session changes, and the
 * CTA is re-resolved by the one resolver the server uses, so the preview can never offer a verb the
 * server would not. Pure: the clock comes in.
 */
export function previewWaitlistOffer(
	offer: ServiceBookingOffer,
	state: WaitlistPreview | undefined,
	now: number,
): ServiceBookingOffer {
	if (!state || state === "auto" || offer.format !== "cohort") return offer;
	const hours = offer.waitlist?.inviteHoldHours ?? DEFAULT_WAITLIST_INVITE_HOLD_HOURS;
	const place: ViewerWaitlistPlace = {
		status: state,
		position: state === "waiting" ? 3 : null,
		holdExpiresAt: state === "invited" ? new Date(now + hours * HOUR).toISOString() : null,
		seatsOpen: state === "invited" ? 1 : 0,
		inviteHoldHours: hours,
	};
	const total = offer.capacity?.total ?? offer.cohort?.seats.total ?? 0;
	const capacity = total > 0 ? seatCount(total, total - (place.seatsOpen ?? 0)) : offer.capacity;
	return {
		...offer,
		waitlist: place,
		capacity,
		cta: resolveCta({
			format: "cohort",
			sessionCount: 1,
			seatsRemaining: capacity?.remaining ?? 0,
			cohortOpen: offer.cohort !== null,
			waitlist: place,
			draftHref: null,
			bookingsOpen: true,
		}),
	};
}
