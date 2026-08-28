import { BookingBackendService } from "@server/services/booking/BookingBackendService.ts";
import { serviceSimFromParams } from "@projective/types/services";
import type { ServiceBookingOffer } from "@projective/types/services";
import type { UserContext } from "@projective/types/auth";
import { bookingActorFromContext } from "./booking-actor.ts";
import { ANONYMOUS_ACTOR } from "@server/services/booking/BookingBackendService.ts";

/**
 * The SSR resolver bridging the route and the layout slot to the fat {@link BookingBackendService}.
 *
 * A single in-process call — no HTTP hop — so the standalone page body AND its conversion lane get the
 * SAME offer object on the first byte. Mirrors `resolveViewPage`, `resolveProfile` and
 * `resolveSchedulePage` beside it.
 *
 * # Why this exists rather than a fetch in an effect
 *
 * The listing page is public and SEO-facing, and the CTA is the reason it exists. Every fact the CTA
 * branches on is a fact the server owns — how many cohort seats are left, whether this seller takes
 * discovery calls, whether this buyer already has a draft pipeline — so resolving it client-side would
 * ship a first byte whose primary control is absent or wrong and then change it under the reader's
 * cursor, on the one control the whole page is built around.
 *
 * # The developer overlay travels on the URL
 *
 * The Dev Context Switcher is a client seam the server cannot see, so its axes ride the query string
 * and this resolver parses them the same way the thin routes do. In production
 * {@link serviceSimFromParams} finds nothing and returns `undefined`, so the SSR request is
 * byte-identical to one from before the seam existed.
 */

/** What the resolver needs beyond the listing id. */
export interface BookingOfferOptions {
	/** The acting viewer's chrome context, or `undefined` for a guest. */
	context?: UserContext;
	/** The profile handle when the listing is being viewed profile-scoped, so the sign-in bounce returns there. */
	handle?: string | null;
	/** The request URL, carrying any developer simulation overlay. */
	url?: URL;
}

/**
 * Resolve the booking offer for a listing. `null` when the id resolves to nothing, so a caller can
 * degrade rather than render a rig for a listing that does not exist.
 */
export function resolveBookingOffer(
	subjectId: string,
	opts: BookingOfferOptions = {},
): ServiceBookingOffer | null {
	const actor = opts.context ? bookingActorFromContext(opts.context) : ANONYMOUS_ACTOR;
	const result = BookingBackendService.offer(subjectId, actor, {
		handle: opts.handle ?? null,
		sim: opts.url ? serviceSimFromParams(opts.url.searchParams) : undefined,
	});
	return result.ok && result.data ? result.data.offer : null;
}
