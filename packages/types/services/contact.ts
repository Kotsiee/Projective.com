import { z } from "zod";
import { PublicCallOfferSchema } from "../scheduling/calls.ts";

/**
 * services.contact — the **Contact Me** popover: what it may offer, and what each of its three
 * actions sends.
 *
 * All three are top-of-funnel. None of them creates a project, a stage, a ticket or an escrow, and
 * none of them enters the delivery state machine — a buyer asking a question has not commissioned
 * anything, and a surface that turns a question into a project record punishes people for asking.
 * That is the same rule `PRODUCT_SPEC.md` §Discovery & Courtesy Calls states for a discovery call,
 * applied to the whole menu.
 *
 * **The offer is resolved SERVER-side and an unavailable action is ABSENT, not disabled.** A seller
 * who takes no discovery calls has no "Book a discovery call" row: a disabled control advertises a
 * capability and then refuses it, and here the capability genuinely does not exist. The one exception
 * is the sign-in bounce, which is a state the viewer can change.
 */

// #region Actions
/**
 * The three things a buyer can do before buying.
 *
 * Deliberately not "Message seller" plus a pile of near-synonyms: each member routes to a different
 * system (scheduling · comms · the quote ledger) and produces a different record.
 */
export const ContactActionKind = z.enum([
	/** `scheduling.discovery_calls` — a courtesy or paid call against the provider's call windows. */
	"discovery_call",
	/** `comms.get_or_create_dm_thread` — an ordinary DM, opened at `/messages/[chatId]`. */
	"ask_question",
	/** A soft-budget scope proposal recorded against the service blueprint. */
	"custom_quote",
]);
export type ContactActionKind = z.infer<typeof ContactActionKind>;

/** One row in the popover. Present only when the seller actually offers it. */
export const ContactActionSchema = z.object({
	kind: ContactActionKind,
	label: z.string().min(1).max(60),
	/** The one-line explanation under the label — what this does, in the buyer's terms. */
	description: z.string().max(160),
	/**
	 * Where the row navigates INSTEAD of opening a panel. Used by the discovery-call row when the
	 * provider publishes a full availability page: sending a buyer to the page that shows every free
	 * hour beats a modal showing a two-week window of it.
	 */
	href: z.string().max(400).nullable(),
});
export type ContactAction = z.infer<typeof ContactActionSchema>;

/**
 * What this seller offers, resolved for this viewer.
 *
 * `requiresSignIn` is separate from an empty `actions` list on purpose. They render differently — one
 * says "this seller does not take questions", which would be false, and the other says "sign in to
 * ask", which is true and recoverable.
 */
export const ContactOfferSchema = z.object({
	/** The seller's `@handle`, without the `@`. */
	handle: z.string().min(1).max(64),
	sellerName: z.string().min(1).max(160),
	sellerAvatar: z.string().max(600).nullable(),
	/** The listing the question is about — every action carries it so the seller has context. */
	subjectId: z.string().min(1).max(160),
	subjectTitle: z.string().min(1).max(200),
	actions: z.array(ContactActionSchema),
	/** The public slice of the provider's call settings, when they take calls at all. */
	callOffer: PublicCallOfferSchema.optional(),
	/** A guest — every action bounces to sign-in first, with a return path to this listing. */
	requiresSignIn: z.boolean(),
	/** Where that bounce goes. `null` for a signed-in viewer. */
	signInHref: z.string().max(400).nullable(),
});
export type ContactOffer = z.infer<typeof ContactOfferSchema>;
// #endregion

// #region Write payloads
/**
 * Request a discovery call.
 *
 * `slotId` addresses a slot in the grid the picker was drawn from, and the server re-resolves it
 * through the same reader rather than trusting the instants — the {@link "../scheduling/scheduling.ts"}
 * `SchedulingTarget` rule, for the same reason: a caller who supplies their own start time can
 * address a slot the reader would never have offered them.
 */
export const DiscoveryCallRequestSchema = z.object({
	kind: z.literal("discovery_call"),
	handle: z.string().min(1).max(64),
	subjectId: z.string().min(1).max(160),
	slotId: z.string().min(1).max(80),
	/** `courtesy` (free) or `paid`. The server re-checks it against the provider's real settings. */
	callType: z.enum(["courtesy", "paid"]),
	/** The IANA zone the requester was looking at, recorded on the booking so the trail stays legible. */
	timezone: z.string().max(60).optional(),
	/** The purpose. Required when the provider set `agendaRequired`; the server enforces that. */
	agenda: z.string().max(2000).optional(),
});
export type DiscoveryCallRequest = z.infer<typeof DiscoveryCallRequestSchema>;

/**
 * Open (or reuse) a DM thread and say something in the same act.
 *
 * The message is part of THIS payload rather than a follow-up call: a thread that is created while
 * the send fails leaves an empty conversation and a lost question, which is the exact failure the
 * combined payload exists to prevent (the Decision #79 finding).
 */
export const AskQuestionInputSchema = z.object({
	kind: z.literal("ask_question"),
	handle: z.string().min(1).max(64),
	subjectId: z.string().min(1).max(160),
	message: z.string().min(1).max(4000),
});
export type AskQuestionInput = z.infer<typeof AskQuestionInputSchema>;

/**
 * A custom-scope proposal against the service blueprint.
 *
 * **The budget is SOFT and the field names say so.** `budgetMinor` is what the buyer is willing to
 * spend, not a price: a service's price is provider-set (`PRODUCT_SPEC.md` §Why Sessions are Fixed),
 * and a proposal that looked like a counter-offer would invite a negotiation the platform does not
 * model. Optional, because "I don't know yet, what would this cost?" is a legitimate first message
 * and forcing a number out of someone who has none produces a fictional one.
 */
export const QuoteRequestInputSchema = z.object({
	kind: z.literal("custom_quote"),
	handle: z.string().min(1).max(64),
	subjectId: z.string().min(1).max(160),
	/** What the buyer needs, in their own words. */
	scope: z.string().min(1).max(4000),
	/** The soft budget in integer minor units. */
	budgetMinor: z.number().int().min(0).optional(),
	/** ISO-4217. Required alongside a budget, so an amount is never quoted currency-less. */
	currency: z.string().min(3).max(3).optional(),
	/** A free-text deadline ("mid-March", "before our launch"), never parsed into a date. */
	timeline: z.string().max(200).optional(),
});
export type QuoteRequestInput = z.infer<typeof QuoteRequestInputSchema>;

/** Any contact action. Discriminated on `kind`, so one thin route serves all three. */
export const ContactActionInputSchema = z.discriminatedUnion("kind", [
	DiscoveryCallRequestSchema,
	AskQuestionInputSchema,
	QuoteRequestInputSchema,
]);
export type ContactActionInput = z.infer<typeof ContactActionInputSchema>;
// #endregion

// #region Result
/**
 * What happened, in the shape the island renders.
 *
 * `navigateTo` is a suggestion the island may follow, never an instruction it must: an "Ask a
 * question" resolves by navigating to the thread, while a quote request resolves in place with a
 * confirmation, and the same handler serves both.
 */
export const ContactActionResultSchema = z.object({
	kind: ContactActionKind,
	/** The record created or reused — a `dm-…` chat id, a call id, a quote id. */
	referenceId: z.string().max(160).nullable(),
	/** The sentence the surface shows on success. Server-authored, so the copy has one home. */
	confirmation: z.string().max(240),
	/** Where to send the viewer next, or `null` to resolve in place. */
	navigateTo: z.string().max(400).nullable(),
});
export type ContactActionResult = z.infer<typeof ContactActionResultSchema>;
// #endregion
