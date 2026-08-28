import { z } from "zod";
import { ServiceBookingFormat } from "./common.ts";

/**
 * services.booking — the **write payloads** for the four booking flows, and the outcome shape all of
 * them resolve to.
 *
 * Every flow lands in the same place: a line in the buyer's basket, or a route to `/checkout`. That
 * is deliberate and it is the reason these live together. The alternative — each format owning its
 * own path to payment — is how a product comes to have four checkouts that price, tax and refund
 * slightly differently.
 *
 * **Nothing here computes money.** A payload names WHAT is being bought (which slots, which stages,
 * how many sessions); the fat service resolves the price from the listing and the SSOT's own
 * `checkoutTotals`, and the client renders what comes back. A client-supplied total is a
 * price-tampering hole, and `CheckoutBackendService.create` already re-verifies one for exactly that
 * reason.
 */

// #region Session booking
/**
 * Book one or more slots against a session listing.
 *
 * `slotIds` is an array even for a single session, because a set-session block MAY schedule several
 * up front and a cohort seat is one occurrence of a recurring series — one shape covers all three,
 * and the count is validated against the listing server-side rather than by shape.
 *
 * **A set-session block requires exactly ONE slot at checkout.** The remaining `n - 1` are scheduled
 * after payment, which is the honest model: the buyer is committing to a block, not to six specific
 * Tuesdays four months out that they will inevitably need to move. The server enforces it; the
 * schema does not, because the rule is a property of the listing (its `sessionCount`) and a schema
 * that hard-coded `.length === 1` could not express a buyer who chose to schedule all of them.
 */
export const SessionBookingInputSchema = z.object({
	/** The listing being booked. */
	subjectId: z.string().min(1).max(160),
	format: ServiceBookingFormat,
	/** The chosen slots, by grid id. Ascending is not required — the server sorts. */
	slotIds: z.array(z.string().min(1).max(80)).min(1).max(52),
	/** The IANA zone the buyer chose in, recorded on the booking so the trail stays legible. */
	timezone: z.string().max(60).optional(),
	/** Anything the buyer wants the provider to know before the session. */
	note: z.string().max(2000).optional(),
	/**
	 * Seats for a cohort. Defaults to 1. Capped low deliberately: a group session is priced per seat
	 * and a bulk enrolment is a different conversation (and a different escrow), so the ceiling is a
	 * guard rather than a limit anyone should hit.
	 */
	seats: z.number().int().min(1).max(20).default(1),
});
export type SessionBookingInput = z.infer<typeof SessionBookingInputSchema>;
// #endregion

// #region Scoped engagements (One-Off · Single Task)
/**
 * How much of a staged engagement is being funded now.
 *
 * `first_stage` is the platform's actual escrow model for staged work — funds are held per stage, so
 * a buyer commits to stage 1 and the rest follows as the work does. `whole_project` is offered
 * because a buyer who already trusts the provider should not have to return five times, and because
 * some engagements are only sensible as a whole.
 */
export const StageFundingScope = z.enum(["first_stage", "whole_project"]);
export type StageFundingScope = z.infer<typeof StageFundingScope>;

/** One attachment staged with a brief. Staged by NAME until the upload path lands. */
export const BriefAttachmentSchema = z.object({
	name: z.string().min(1).max(260),
	sizeBytes: z.number().int().min(0),
	mimeType: z.string().max(160).optional(),
	/** The `files.items` id, once the asset pipeline is wired. `null` while staged by name only. */
	assetId: z.string().max(80).nullable(),
});
export type BriefAttachment = z.infer<typeof BriefAttachmentSchema>;

/**
 * Configure a One-Off or a Single Task and stage it for checkout.
 *
 * The two share a payload because they differ only in which fields they populate: a Single Task has
 * no stages to scope, so it sends `requirements` and nothing else. Two schemas would mean two
 * validators, two routes and two places for the requirements field to gain a different maximum.
 */
export const ServiceBriefInputSchema = z.object({
	subjectId: z.string().min(1).max(160),
	format: ServiceBookingFormat,
	/** What the buyer needs. Required — this IS the specification the engagement is delivered against. */
	requirements: z.string().min(1).max(8000),
	/**
	 * Which stages to fund now. Ignored for a Single Task, which has one deliverable and no stages.
	 * Defaults to `first_stage`, the smaller commitment: a default that funds everything is a default
	 * that charges more than the buyer chose to.
	 */
	fundingScope: StageFundingScope.default("first_stage"),
	/**
	 * Explicit stage ids when the buyer scoped a subset. Empty means "whatever `fundingScope` implies",
	 * so the common path sends nothing and the server resolves it from the listing.
	 */
	stageIds: z.array(z.string().min(1).max(120)).max(24).default([]),
	attachments: z.array(BriefAttachmentSchema).max(10).default([]),
});
export type ServiceBriefInput = z.infer<typeof ServiceBriefInputSchema>;
// #endregion

// #region Outcome
/**
 * Where a completed booking flow leaves the buyer.
 *
 * One shape for all four flows so the island has one handler. `route` is where to go, `basketItemId`
 * is what was added (so a surface can update its own "in basket" mirror without a refetch), and
 * `summary` is the server's own sentence — the copy has one home, and a refusal explains itself in
 * the same field a success does.
 */
export const BookingOutcomeSchema = z.object({
	/** The listing that was booked. */
	subjectId: z.string().min(1).max(160),
	format: ServiceBookingFormat,
	/** The basket line created, or `null` for a flow that creates no line (a discovery call). */
	basketItemId: z.string().max(80).nullable(),
	/** Where to send the buyer. `/checkout`, `/checkout/payment`, or a project board. */
	route: z.string().min(1).max(400),
	/** The confirmation sentence. */
	summary: z.string().max(240),
	/**
	 * How many sessions were scheduled versus committed to — the set-session disclosure. `null` for
	 * every non-session format.
	 */
	scheduled: z.object({
		booked: z.number().int().min(0),
		total: z.number().int().min(1),
		/** The first scheduled instant, epoch ms, or `null` when nothing was scheduled yet. */
		firstStartsAt: z.number().int().nullable(),
	}).nullable(),
});
export type BookingOutcome = z.infer<typeof BookingOutcomeSchema>;
// #endregion
