import { z } from "zod";

/**
 * services.quotes — a custom quote request and the host's priced offers on it (Decision #458).
 *
 * A buyer asks the seller of a service to price custom scope; the host answers with an offer (scope,
 * a deliverables checklist, one price, a turnaround, an expiry) and may revise it, which supersedes
 * the pending one; the buyer accepts it, which puts exactly one `one_off_service` line in their basket,
 * or declines it. Money moves only at checkout, where the offer — never the line's snapshot — is the
 * price, and the deliverables are a checklist inside ONE escrow.
 *
 * Rows mirror `marketplace.quote_requests` and `marketplace.quote_offers` column for column; the
 * views are what the conversation panel and the client drawer render, with every act derived
 * server-side so a control only renders when its door would accept it.
 */

// #region Lifecycles and bounds
/** `marketplace.quote_requests.status` (PRODUCT_MANAGEMENT §3.5). */
export const QuoteRequestStatus = z.enum(["sent", "answered", "accepted", "declined", "withdrawn"]);
export type QuoteRequestStatus = z.infer<typeof QuoteRequestStatus>;

/** `marketplace.quote_offers.status` as stored. */
export const QuoteOfferStatus = z.enum(["pending", "accepted", "declined", "withdrawn"]);
export type QuoteOfferStatus = z.infer<typeof QuoteOfferStatus>;

/** An offer as read: the stored status, or `expired` for a pending one past its expiry (derived). */
export const QuoteOfferState = z.enum(["pending", "accepted", "declined", "withdrawn", "expired"]);
export type QuoteOfferState = z.infer<typeof QuoteOfferState>;

/** The bounds the doors and the table CHECKs enforce. */
export const QUOTE_LIMITS = {
	scopeMax: 4000,
	deliverablesMax: 12,
	deliverableMax: 160,
	turnaroundDays: { min: 1, max: 90 },
	expiresInDays: { min: 3, max: 30, default: 14 },
	declineReasonMax: 280,
} as const;
// #endregion

// #region Rows
const isoInstant = z.string().min(1);
const currencyCode = z.string().regex(/^[A-Z]{3}$/);

/** One `marketplace.quote_requests` row. */
export const QuoteRequestRowSchema = z.object({
	id: z.string().uuid(),
	blueprint_id: z.string().uuid(),
	host_user_id: z.string().uuid(),
	requester_user_id: z.string().uuid(),
	scope: z.string().min(1),
	budget_cents: z.number().int().min(0).nullable(),
	currency: currencyCode.nullable(),
	timeline: z.string().nullable(),
	status: QuoteRequestStatus,
	answered_at: isoInstant.nullable(),
	closed_at: isoInstant.nullable(),
	decline_reason: z.string().max(QUOTE_LIMITS.declineReasonMax).nullable(),
	created_at: isoInstant,
	updated_at: isoInstant,
});
export type QuoteRequestRow = z.infer<typeof QuoteRequestRowSchema>;

/** One `marketplace.quote_offers` row. */
export const QuoteOfferRowSchema = z.object({
	id: z.string().uuid(),
	quote_request_id: z.string().uuid(),
	author_user_id: z.string().uuid(),
	scope: z.string().min(1).max(QUOTE_LIMITS.scopeMax),
	deliverables: z.array(z.string().max(QUOTE_LIMITS.deliverableMax)).max(
		QUOTE_LIMITS.deliverablesMax,
	),
	price_cents: z.number().int().positive(),
	currency: currencyCode,
	turnaround_days: z.number().int().min(QUOTE_LIMITS.turnaroundDays.min).max(
		QUOTE_LIMITS.turnaroundDays.max,
	),
	expires_at: isoInstant,
	status: QuoteOfferStatus,
	superseded_by: z.string().uuid().nullable(),
	decided_at: isoInstant.nullable(),
	created_at: isoInstant,
	updated_at: isoInstant,
});
export type QuoteOfferRow = z.infer<typeof QuoteOfferRowSchema>;

/** The current offer inside one `marketplace.get_quotes_with` entry. */
export const QuoteWithOfferRowSchema = z.object({
	id: z.string().uuid(),
	status: QuoteOfferStatus,
	expired: z.boolean(),
	scope: z.string(),
	deliverables: z.array(z.string()),
	price_cents: z.number().int().positive(),
	currency: currencyCode,
	turnaround_days: z.number().int(),
	expires_at: isoInstant,
	created_at: isoInstant,
	decided_at: isoInstant.nullable(),
});

/** One entry of `marketplace.get_quotes_with(counterpart)`, as the database returns it. */
export const QuoteWithRowSchema = z.object({
	id: z.string().uuid(),
	role: z.enum(["buyer", "host"]),
	status: QuoteRequestStatus,
	scope: z.string(),
	budget_cents: z.number().int().min(0).nullable(),
	currency: currencyCode.nullable(),
	timeline: z.string().nullable(),
	decline_reason: z.string().nullable(),
	created_at: isoInstant,
	answered_at: isoInstant.nullable(),
	closed_at: isoInstant.nullable(),
	blueprint_id: z.string().uuid(),
	listing_slug: z.string(),
	listing_title: z.string(),
	listing_currency: currencyCode,
	listing_delivery_model: z.string(),
	free_revisions: z.number().int().min(0).nullable(),
	offers_sent: z.number().int().min(0),
	offer: QuoteWithOfferRowSchema.nullable(),
	basket_item_id: z.string().uuid().nullable(),
	ordered: z.boolean(),
});
export type QuoteWithRow = z.infer<typeof QuoteWithRowSchema>;
// #endregion

// #region Views
/** The viewer's side of a request. */
export const QuoteRole = z.enum(["buyer", "host"]);
export type QuoteRole = z.infer<typeof QuoteRole>;

/** An offer as the panel and the drawer render it. Money stays in minor units for `MoneyView`. */
export const QuoteOfferViewSchema = z.object({
	id: z.string().uuid(),
	state: QuoteOfferState,
	scope: z.string(),
	deliverables: z.array(z.string()),
	priceMinor: z.number().int().positive(),
	currency: currencyCode,
	turnaroundDays: z.number().int(),
	expiresAt: isoInstant,
	sentAt: isoInstant,
});
export type QuoteOfferView = z.infer<typeof QuoteOfferViewSchema>;

/** The acts a viewer may take on a request, derived server-side from its state and their side. */
export const QuoteActionKind = z.enum([
	"send_offer",
	"withdraw_offer",
	"decline_request",
	"accept_offer",
	"decline_offer",
	"withdraw_request",
	"checkout",
]);
export type QuoteActionKind = z.infer<typeof QuoteActionKind>;

/** One request between the viewer and the other person. */
export const QuoteViewSchema = z.object({
	id: z.string().uuid(),
	role: QuoteRole,
	status: QuoteRequestStatus,
	/** The buyer's ask, in their words. */
	scope: z.string(),
	budgetMinor: z.number().int().min(0).nullable(),
	budgetCurrency: currencyCode.nullable(),
	timeline: z.string().nullable(),
	declineReason: z.string().nullable(),
	requestedAt: isoInstant,
	listing: z.object({
		slug: z.string(),
		title: z.string(),
		href: z.string().max(200),
		/** A group-session listing: the request is for a private cohort. */
		privateCohort: z.boolean(),
		/** The listing's currency — every offer on it is priced in it. */
		currency: currencyCode,
	}),
	/** Revisions the listing includes, which a custom offer carries over; `null` when unstated. */
	freeRevisions: z.number().int().min(0).nullable(),
	offersSent: z.number().int().min(0),
	offer: QuoteOfferViewSchema.nullable(),
	/** The accepted offer has been paid for: its engagement now runs as a project. */
	ordered: z.boolean(),
	/**
	 * What the viewer may do now. `checkout` re-runs the idempotent accept, which returns (or re-adds)
	 * the offer's one basket line, then goes to the basket.
	 */
	actions: z.array(QuoteActionKind).max(QuoteActionKind.options.length),
});
export type QuoteView = z.infer<typeof QuoteViewSchema>;

/** Every request between the viewer and one other person, newest first. */
export const QuoteListSchema = z.object({ quotes: z.array(QuoteViewSchema).max(20) });
export type QuoteList = z.infer<typeof QuoteListSchema>;

/** The offer as read, with `expired` folded into its state. */
function offerStateOf(offer: NonNullable<QuoteWithRow["offer"]>): QuoteOfferState {
	return offer.status === "pending" && offer.expired ? "expired" : offer.status;
}

/** The acts the doors would accept from this viewer now (00001177). Pure. */
export function quoteActionsOf(row: QuoteWithRow): QuoteActionKind[] {
	const open = row.status === "sent" || row.status === "answered";
	const offerState = row.offer ? offerStateOf(row.offer) : null;
	if (row.role === "host") {
		if (!open) return [];
		return offerState === "pending"
			? ["send_offer", "withdraw_offer", "decline_request"]
			: ["send_offer", "decline_request"];
	}
	if (row.status === "accepted") return row.ordered ? [] : ["checkout", "withdraw_request"];
	if (!open) return [];
	return row.status === "answered" && offerState === "pending"
		? ["accept_offer", "decline_offer", "withdraw_request"]
		: ["withdraw_request"];
}

/** A `get_quotes_with` entry as the panel and the drawer render it. Pure. */
export function quoteViewOf(row: QuoteWithRow): QuoteView {
	return {
		id: row.id,
		role: row.role,
		status: row.status,
		scope: row.scope,
		budgetMinor: row.budget_cents,
		budgetCurrency: row.currency,
		timeline: row.timeline,
		declineReason: row.decline_reason,
		requestedAt: row.created_at,
		listing: {
			slug: row.listing_slug,
			title: row.listing_title,
			href: `/view/${row.listing_slug}`,
			privateCohort: row.listing_delivery_model === "group_session",
			currency: row.listing_currency,
		},
		freeRevisions: row.free_revisions,
		offersSent: row.offers_sent,
		offer: row.offer
			? {
				id: row.offer.id,
				state: offerStateOf(row.offer),
				scope: row.offer.scope,
				deliverables: row.offer.deliverables,
				priceMinor: row.offer.price_cents,
				currency: row.offer.currency,
				turnaroundDays: row.offer.turnaround_days,
				expiresAt: row.offer.expires_at,
				sentAt: row.offer.created_at,
			}
			: null,
		ordered: row.ordered,
		actions: quoteActionsOf(row),
	};
}
// #endregion

// #region Write payloads
/** The host's offer, sent or revised. */
export const SendQuoteOfferInputSchema = z.object({
	action: z.literal("send_offer"),
	scope: z.string().trim().min(1).max(QUOTE_LIMITS.scopeMax),
	deliverables: z.array(z.string().trim().min(1).max(QUOTE_LIMITS.deliverableMax)).max(
		QUOTE_LIMITS.deliverablesMax,
	),
	/** In the listing's minor units; the door prices it in the listing's currency. */
	priceMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
	turnaroundDays: z.number().int().min(QUOTE_LIMITS.turnaroundDays.min).max(
		QUOTE_LIMITS.turnaroundDays.max,
	),
	expiresInDays: z.number().int()
		.min(QUOTE_LIMITS.expiresInDays.min)
		.max(QUOTE_LIMITS.expiresInDays.max)
		.default(QUOTE_LIMITS.expiresInDays.default),
});
export type SendQuoteOfferInput = z.infer<typeof SendQuoteOfferInputSchema>;

const offerAct = <T extends string>(action: T) =>
	z.object({ action: z.literal(action), offerId: z.string().uuid() });

/**
 * `POST /api/quotes/[id]` — one act on one request: the host sends, withdraws or declines; the buyer
 * accepts, declines or withdraws. Each maps to one door in 00001177, which re-checks who may act.
 */
export const QuoteActInputSchema = z.discriminatedUnion("action", [
	SendQuoteOfferInputSchema,
	offerAct("withdraw_offer"),
	offerAct("accept_offer"),
	offerAct("decline_offer"),
	z.object({
		action: z.literal("decline_request"),
		reason: z.string().trim().max(QUOTE_LIMITS.declineReasonMax).optional(),
	}),
	z.object({ action: z.literal("withdraw_request") }),
]);
export type QuoteActInput = z.infer<typeof QuoteActInputSchema>;

/** What an act answers: the request as it now stands. */
export const QuoteActResultSchema = z.object({
	quote: QuoteViewSchema,
	/** The sentence the surface shows. Server-authored, so the copy has one home. */
	confirmation: z.string().max(240),
	/** The basket now holding the offer's line — set by an accept, for the move to checkout. */
	basketId: z.string().uuid().nullable(),
});
export type QuoteActResult = z.infer<typeof QuoteActResultSchema>;
// #endregion
