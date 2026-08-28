import { z } from "zod";
import { ServiceBookingFormat, ServiceCtaRigSchema } from "./common.ts";
import { ContactOfferSchema } from "./contact.ts";
import { PipelineDraftSchema } from "./pipeline.ts";

/**
 * services.offer — the **resolved commercial offer** for one listing and one viewer: what the primary
 * control says, what it does, what the Contact menu may show, and whether there is already a draft.
 *
 * # Why this is one server-resolved object
 *
 * Every fact the CTA branches on is a fact the SERVER owns — how many cohort seats are left, whether
 * this seller takes discovery calls, whether this buyer already instantiated the pipeline. Resolving
 * them separately in the lane and again in the mobile buy bar is how two regions of one page come to
 * offer different things, which is the failure §D.7.4 exists to prevent. So the offer is resolved
 * once, and both regions render it.
 *
 * # Why it must SSR
 *
 * The listing page is public and SEO-facing, and the CTA is the reason it exists. Resolving the offer
 * in an effect would ship a first byte whose primary control is either absent or wrong, and then
 * change it under the reader's cursor. It is therefore resolved by the same URL-keyed slot resolver
 * that paints the lane, and the island takes it as `initial` — refetching only when the developer
 * seam changes something the server could not have seen.
 */

// #region Capacity
/**
 * Seat position for a cohort.
 *
 * `sentence` is built server-side and is the ACCESSIBLE fact: a segmented meter cannot be read aloud,
 * and a nearly-full cohort is exactly when the number matters most. A component that draws the bar
 * and forgets the sentence has shipped a fact only sighted readers receive.
 */
export const CohortCapacitySchema = z.object({
	total: z.number().int().min(0),
	taken: z.number().int().min(0),
	remaining: z.number().int().min(0),
	sentence: z.string().max(160),
});
export type CohortCapacity = z.infer<typeof CohortCapacitySchema>;
// #endregion

// #region Offer
/** The complete offer both transactional regions render. */
export const ServiceBookingOfferSchema = z.object({
	/** The listing. */
	subjectId: z.string().min(1).max(160),
	subjectTitle: z.string().min(1).max(200),
	format: ServiceBookingFormat,
	/** The action rig — exactly one `filled` primary, at most one secondary (§B.8.2). */
	cta: ServiceCtaRigSchema,
	/** The Contact Me menu for this seller and viewer. */
	contact: ContactOfferSchema,
	/** Cohort seats, or `null` for every format without finite capacity. */
	capacity: CohortCapacitySchema.nullable(),
	/**
	 * The pipeline draft this buyer already has for this service, or `null`.
	 *
	 * Its presence is what flips the primary from "Add to Projects" to "Open Project →", so it is
	 * resolved server-side: a client that had to ask after painting would show the wrong verb for one
	 * round trip on every visit, on the one control the page exists for.
	 */
	draft: PipelineDraftSchema.nullable(),
	/**
	 * How many sessions a booking commits to. `1` everywhere except a set-session block. Drives the
	 * "Book 6 sessions" label and the picker's "schedule the first now" disclosure.
	 */
	sessionCount: z.number().int().min(1).max(52),
	/** Each session's length in minutes, from the provider's service settings. `null` when not timed. */
	durationMinutes: z.number().int().min(5).max(600).nullable(),
	/** Whether this listing escrows at purchase — gates the "funds held in escrow" ledger row. */
	escrows: z.boolean(),
	/** A guest. Every write bounces to sign-in first, returning to this listing. */
	requiresSignIn: z.boolean(),
	/** Where that bounce goes. `null` for a signed-in viewer. */
	signInHref: z.string().max(400).nullable(),
});
export type ServiceBookingOffer = z.infer<typeof ServiceBookingOfferSchema>;
// #endregion

// #region Query
/** Params for an offer read. */
export const OfferQuerySchema = z.object({
	subjectId: z.string().min(1).max(160),
	/** The profile-scoped listing route, so the sign-in bounce returns to the URL the viewer is on. */
	handle: z.string().max(64).optional(),
});
export type OfferQuery = z.infer<typeof OfferQuerySchema>;
// #endregion
