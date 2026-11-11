import { BookingBackendService } from "@server/services/booking/BookingBackendService.ts";
import type { EntityView } from "@projective/types/explore";
import type { ServiceBookingOffer } from "@projective/types/services";
import type { UserContext } from "@projective/types/auth";
import { bookingActorFromContext } from "./booking-actor.ts";
import { ANONYMOUS_ACTOR } from "@server/services/booking/BookingBackendService.ts";
import type { ReadActor } from "@server/services/read-actor.ts";
import { resolveArchetype } from "./entity-archetype.ts";

/**
 * The SSR resolver bridging the route and the layout slot to the fat {@link BookingBackendService}.
 *
 * A single in-process call — no HTTP hop — so the standalone page body AND its conversion lane get the
 * SAME offer object on the first byte. Mirrors `resolveViewPage` and `resolveProfile` beside it.
 *
 * # Why this exists rather than a fetch in an effect
 *
 * The listing page is public and SEO-facing, and the CTA is the reason it exists. Every fact the CTA
 * branches on is a fact the server owns — how many cohort seats are left, whether this seller takes
 * discovery calls, whether this buyer already has a draft pipeline — so resolving it client-side would
 * ship a first byte whose primary control is absent or wrong and then change it under the reader's
 * cursor, on the one control the whole page is built around.
 *
 * # Resolved in the route handler
 *
 * The offer is read from the database (the seller's call settings and schedule), so it is awaited in
 * the ROUTE HANDLER and handed to the page as data — a page component cannot await.
 */

/** What the resolver needs beyond the listing id. */
export interface BookingOfferOptions {
	/** The acting viewer's chrome context, or `undefined` for a guest. */
	context?: UserContext;
	/** The profile handle when the listing is being viewed profile-scoped, so the sign-in bounce returns there. */
	handle?: string | null;
}

/**
 * Resolve the booking offer for a listing. `null` when the id resolves to nothing, so a caller can
 * degrade rather than render a rig for a listing that does not exist.
 */
export async function resolveBookingOffer(
	subjectId: string,
	opts: BookingOfferOptions = {},
): Promise<ServiceBookingOffer | null> {
	const actor = opts.context ? bookingActorFromContext(opts.context) : ANONYMOUS_ACTOR;
	const result = await BookingBackendService.offer(subjectId, actor, { handle: opts.handle ?? null });
	return result.ok && result.data ? result.data.offer : null;
}

/**
 * The booking offer the listing page's commerce regions (the lane and the buy bar) render. A session
 * listing books from the slot picker its primary opens, so nothing else is resolved for it. A project
 * is applied to, never booked or bought, so it resolves no offer.
 */
export async function resolveEntityCommerce(
	view: EntityView,
	opts: BookingOfferOptions & {
		/**
		 * The owner's buyer simulation (`/catalogue/[id]/simulate`, Decision #217 (j)): the real offer,
		 * read from the listing as its seller sees it (a draft included), for a signed-in first-time
		 * buyer — none of the "already in your projects" or sign-in states the owner's own session would
		 * resolve.
		 */
		simulation?: { owner: ReadActor };
	},
): Promise<{ offer: ServiceBookingOffer | null }> {
	const archetype = resolveArchetype(view);
	if (archetype === "project" || archetype === "article") return { offer: null };
	if (opts.simulation) {
		const offered = await BookingBackendService.simulatedOffer(view.item.id, opts.simulation.owner);
		return { offer: offered.ok && offered.data ? offered.data.offer : null };
	}
	return { offer: await resolveBookingOffer(view.item.id, opts) };
}
