import type { JSX } from "preact";
import { useComputed } from "@preact/signals";
import { useEffect } from "preact/hooks";
import SessionBookingModal from "./SessionBookingModal.island.tsx";
import ScopeBriefModal from "./ScopeBriefModal.island.tsx";
import QuoteRequestModal from "./QuoteRequestModal.island.tsx";
import {
	type BookingHost,
	bookingHost,
	bookingStatus,
	registerBookingHost,
	seedOffer,
} from "../core/booking-state.ts";
import { useBookingSeam } from "../core/booking-seam.ts";
import { BookingService } from "../core/BookingService.ts";
import { applyOffer } from "../core/booking-state.ts";
import type { ServiceBookingOffer } from "@projective/types/services";
import type { ProjectStage } from "@projective/types/explore";

/**
 * BookingPanels — the single mount point for every booking overlay on a listing page, and the one
 * place the shared offer is seeded and kept fresh.
 *
 * # Why a host election
 *
 * The transaction is carried by two mutually exclusive regions: the middle-nav conversion lane above
 * `--bp-md` and the in-body buy bar below it. They hide each other by `display`, not by unmounting —
 * so BOTH are live hydration roots at every width, and both would render this. Every panel here goes
 * through `BodyPortal`, which escapes a hidden ancestor entirely, so two mounted hosts would
 * composite two identical dialogs, two focus traps, and two submissions of one booking.
 *
 * Exactly one host renders, chosen by a FIXED priority rather than by mount order, so the winner
 * cannot change between renders. Lifted verbatim from `buy-now-state.ts`, which solved this for
 * instant checkout — the second time the same problem has been hit is a good moment to reuse the
 * answer rather than reinvent it.
 *
 * # Why the status line lives here
 *
 * `role="status"` announces changes to a region that is already in the accessibility tree. A live
 * region mounted inside a dialog that has just closed announces nothing, and one mounted in the lane
 * announces nothing on a phone (the lane is `display: none` there). This host is the only element on
 * the page guaranteed present, visible to assistive tech, and outside every overlay — which is exactly
 * what a live region has to be.
 */
export interface BookingPanelsProps {
	/** The SSR-resolved offer. Seeds the shared signal on mount. */
	offer: ServiceBookingOffer;
	/** Which region this instance is mounted in — decides the election. */
	host: BookingHost;
	/** The listing's stages, for the One-Off funding selector. */
	stages?: readonly ProjectStage[];
	/** The listing's own currency, so every figure in a panel scales the way the body's does. */
	currency?: string;
}

export default function BookingPanels(
	{ offer, host, stages, currency }: BookingPanelsProps,
): JSX.Element | null {
	// Seed before the election, so whichever instance loses still contributes the SSR offer — the
	// signal is shared, and a lane that never renders a panel still renders CTAs that read from it.
	seedOffer(offer);

	useEffect(() => registerBookingHost(host), [host]);

	/*
	 * Re-read the offer when the dev seam changes.
	 *
	 * Every axis it carries changes data the SERVER produced — how many cohort seats are left, whether
	 * this seller takes calls, whether this buyer has a draft — so a client-side read of the seam would
	 * move nothing. The overlay travels as query params and the fat service applies it, which is why
	 * this is a refetch rather than a re-render.
	 *
	 * Only the elected host does it: two hosts refetching one offer is two requests for one answer.
	 */
	useBookingSeam((sim) => {
		if (bookingHost.value !== host) return;
		void (async () => {
			const res = await BookingService.offer(offer.subjectId, { sim });
			if (res.ok && res.data) applyOffer(res.data.offer);
		})();
	});

	const elected = useComputed(() => bookingHost.value === host);
	if (!elected.value) return null;

	return (
		<>
			<SessionBookingModal offer={offer} />
			<ScopeBriefModal offer={offer} stages={stages} currency={currency} />
			<QuoteRequestModal offer={offer} currency={currency} />
			<p class="ui-visually-hidden" role="status" aria-live="polite">{bookingStatus.value}</p>
		</>
	);
}
