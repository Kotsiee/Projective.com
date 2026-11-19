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
 *
 * The evidence (Decision #522): a seller may also issue a quote from a conversation the buyer started;
 * every offer's terms are frozen and carry a SHA-256 `termsHash`; every move is a
 * `marketplace.quote_events` row (the request's `history`) and a quote card in the pair's thread.
 */
import { IntakeAnswersSchema, intakeAnswerLines, IntakeFieldsSchema } from "./intake.ts";

// #region Lifecycles and bounds
/** `marketplace.quote_requests.status` (PRODUCT_MANAGEMENT §3.5). */
export const QuoteRequestStatus = z.enum(["sent", "answered", "accepted", "declined", "withdrawn"]);
export type QuoteRequestStatus = z.infer<typeof QuoteRequestStatus>;

/** `marketplace.quote_offers.status` as stored. */
export const QuoteOfferStatus = z.enum(["pending", "accepted", "declined", "withdrawn"]);
export type QuoteOfferStatus = z.infer<typeof QuoteOfferStatus>;

/**
 * An offer as read: the stored status, or `expired` (derived) for a pending one, or an accepted one not
 * yet paid for, past its expiry — the seller's expiry bounds payment too (CK7, owner ruling A).
 */
export const QuoteOfferState = z.enum(["pending", "accepted", "declined", "withdrawn", "expired"]);
export type QuoteOfferState = z.infer<typeof QuoteOfferState>;

/** Who opened a request: the buyer asking, or the seller issuing a quote (Decision #522). */
export const QuoteOrigin = z.enum(["buyer", "host"]);
export type QuoteOrigin = z.infer<typeof QuoteOrigin>;

/** `marketplace.quote_events.kind`: one move on a request (Decision #522). */
export const QuoteEventKind = z.enum([
	"requested",
	"issued",
	"offer_sent",
	"offer_revised",
	"offer_withdrawn",
	"request_declined",
	"offer_accepted",
	"offer_declined",
	"request_withdrawn",
	"paid",
]);
export type QuoteEventKind = z.infer<typeof QuoteEventKind>;

/** A hex SHA-256 of an offer's canonical terms. */
export const TermsHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

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
	/** The buyer's answers to the listing's own questions, keyed by question id. */
	answers: IntakeAnswersSchema,
	origin: QuoteOrigin,
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
	/** Stamped from the row on insert; the terms never change after (Decision #522). */
	terms_hash: TermsHashSchema,
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
	/** Past its expiry while still pending, or accepted and not yet paid for (`get_quotes_with`). */
	expired: z.boolean(),
	scope: z.string(),
	deliverables: z.array(z.string()),
	price_cents: z.number().int().positive(),
	currency: currencyCode,
	turnaround_days: z.number().int(),
	expires_at: isoInstant,
	created_at: isoInstant,
	decided_at: isoInstant.nullable(),
	terms_hash: TermsHashSchema,
	/** The stored hash still matches the terms re-hashed now. */
	terms_intact: z.boolean(),
});

/** One `marketplace.quote_events` row as a request's history carries it. */
export const QuoteHistoryRowSchema = z.object({
	id: z.string().uuid(),
	kind: QuoteEventKind,
	by: z.enum(["buyer", "host"]),
	at: isoInstant,
	offer_id: z.string().uuid().nullable(),
	terms_hash: TermsHashSchema.nullable(),
});

/** One entry of `marketplace.get_quotes_with(counterpart)`, as the database returns it. */
export const QuoteWithRowSchema = z.object({
	id: z.string().uuid(),
	role: z.enum(["buyer", "host"]),
	status: QuoteRequestStatus,
	origin: QuoteOrigin,
	scope: z.string(),
	answers: IntakeAnswersSchema,
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
	/** The listing's own questions, so the buyer's answers are read back by their labels. */
	intake_fields: z.array(z.unknown()).max(12),
	offers_sent: z.number().int().min(0),
	offer: QuoteWithOfferRowSchema.nullable(),
	history: z.array(QuoteHistoryRowSchema).max(30),
	basket_item_id: z.string().uuid().nullable(),
	ordered: z.boolean(),
});
export type QuoteWithRow = z.infer<typeof QuoteWithRowSchema>;

/** An offer's canonical terms as an event snapshots them (`marketplace.fn_quote_terms`). */
export const QuoteTermsRowSchema = z.object({
	offer: z.string().uuid(),
	request: z.string().uuid(),
	listing: z.string().uuid(),
	seller: z.string().uuid(),
	buyer: z.string().uuid(),
	scope: z.string(),
	deliverables: z.array(z.string()),
	price_cents: z.number().int().positive(),
	currency: currencyCode,
	turnaround_days: z.number().int(),
	expires_at: isoInstant,
	issued_at: isoInstant,
});
export type QuoteTermsRow = z.infer<typeof QuoteTermsRowSchema>;

/** One entry of `marketplace.get_quote_cards(events)`, as the database returns it. */
export const QuoteCardRowSchema = z.object({
	event_id: z.string().uuid(),
	kind: QuoteEventKind,
	by: z.enum(["buyer", "host"]),
	at: isoInstant,
	role: z.enum(["buyer", "host"]),
	request_id: z.string().uuid(),
	request_status: QuoteRequestStatus,
	origin: QuoteOrigin,
	listing_slug: z.string(),
	listing_title: z.string(),
	free_revisions: z.number().int().min(0).nullable(),
	terms: QuoteTermsRowSchema.nullable(),
	terms_hash: TermsHashSchema.nullable(),
	detail: z.record(z.string(), z.unknown()),
	offer: z.object({
		id: z.string().uuid(),
		status: QuoteOfferStatus,
		superseded: z.boolean(),
		ordered: z.boolean(),
		expired: z.boolean(),
		terms_intact: z.boolean(),
	}).nullable(),
});
export type QuoteCardRow = z.infer<typeof QuoteCardRowSchema>;
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
	/** The SHA-256 of the terms; what either party quotes as the offer's reference. */
	termsHash: TermsHashSchema,
	/** The stored hash still matches the terms re-hashed now. */
	termsIntact: z.boolean(),
});
export type QuoteOfferView = z.infer<typeof QuoteOfferViewSchema>;

/** One move in a request's history, newest last. */
export const QuoteHistoryEntrySchema = z.object({
	id: z.string().uuid(),
	kind: QuoteEventKind,
	by: QuoteRole,
	at: isoInstant,
	termsHash: TermsHashSchema.nullable(),
});
export type QuoteHistoryEntry = z.infer<typeof QuoteHistoryEntrySchema>;

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
	origin: QuoteOrigin,
	/** The buyer's ask, in their words (a seller-issued request carries the first offer's scope). */
	scope: z.string(),
	/** The buyer's answers to the listing's questions, as `Label: value` lines. */
	answerLines: z.array(z.string().max(2200)).max(12),
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
	/** Every move on the request, oldest first: the record both parties can point to. */
	history: z.array(QuoteHistoryEntrySchema).max(30),
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

/** The offer as read, with `expired` folded into its state (a pending or an unpaid accepted offer). */
function offerStateOf(offer: NonNullable<QuoteWithRow["offer"]>): QuoteOfferState {
	return offer.expired && (offer.status === "pending" || offer.status === "accepted")
		? "expired"
		: offer.status;
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
	// An accepted offer is paid for before its expiry; past it checkout refuses, so the buyer withdraws
	// the request (its basket line goes with it) and may ask again.
	if (row.status === "accepted") {
		if (row.ordered) return [];
		return offerState === "expired" ? ["withdraw_request"] : ["checkout", "withdraw_request"];
	}
	if (!open) return [];
	return row.status === "answered" && offerState === "pending"
		? ["accept_offer", "decline_offer", "withdraw_request"]
		: ["withdraw_request"];
}

/** A `get_quotes_with` entry as the panel and the drawer render it. Pure. */
export function quoteViewOf(row: QuoteWithRow): QuoteView {
	const fields = IntakeFieldsSchema.safeParse(row.intake_fields);
	return {
		id: row.id,
		role: row.role,
		status: row.status,
		origin: row.origin,
		scope: row.scope,
		answerLines: fields.success
			? intakeAnswerLines(fields.data, row.answers).slice(0, 12).map((l) => l.slice(0, 2200))
			: [],
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
				termsHash: row.offer.terms_hash,
				termsIntact: row.offer.terms_intact,
			}
			: null,
		history: row.history.map((e) => ({ id: e.id, kind: e.kind, by: e.by, at: e.at, termsHash: e.terms_hash })),
		ordered: row.ordered,
		actions: quoteActionsOf(row),
	};
}

/** The first eight characters of a terms hash: how a card and a receipt name an offer's terms. */
export function termsReference(hash: string): string {
	return hash.slice(0, 8).toUpperCase();
}

/** Where one offer named by a quote card stands now. */
export const QuoteCardStateSchema = z.enum([
	"pending",
	"accepted",
	"paid",
	"declined",
	"withdrawn",
	"superseded",
	"expired",
	"closed",
]);
export type QuoteCardState = z.infer<typeof QuoteCardStateSchema>;

/** The acts a quote card offers its viewer: only on the request's live offer, and only the doors'. */
export const QuoteCardActionKind = z.enum(["accept_offer", "decline_offer", "checkout", "withdraw_offer"]);
export type QuoteCardActionKind = z.infer<typeof QuoteCardActionKind>;

/** One quote card in a conversation (Decision #522): one move, the terms as they stood, and now. */
export const QuoteCardViewSchema = z.object({
	eventId: z.string().uuid(),
	kind: QuoteEventKind,
	/** The viewer made this move. */
	mine: z.boolean(),
	at: isoInstant,
	role: QuoteRole,
	requestId: z.string().uuid(),
	listing: z.object({ title: z.string(), href: z.string().max(200) }),
	freeRevisions: z.number().int().min(0).nullable(),
	terms: z.object({
		offerId: z.string().uuid(),
		scope: z.string(),
		deliverables: z.array(z.string()),
		priceMinor: z.number().int().positive(),
		currency: currencyCode,
		turnaroundDays: z.number().int(),
		expiresAt: isoInstant,
		hash: TermsHashSchema,
	}).nullable(),
	/** Where the named offer stands now; `null` on a move that names none. */
	state: QuoteCardStateSchema.nullable(),
	/** The terms still hash to what the card shows. */
	intact: z.boolean(),
	actions: z.array(QuoteCardActionKind).max(QuoteCardActionKind.options.length),
});
export type QuoteCardView = z.infer<typeof QuoteCardViewSchema>;

/** The cards a conversation asked for. */
export const QuoteCardListSchema = z.object({ cards: z.array(QuoteCardViewSchema).max(100) });
export type QuoteCardList = z.infer<typeof QuoteCardListSchema>;

/** Where a card's offer stands now. Pure. */
export function quoteCardStateOf(row: QuoteCardRow): QuoteCardState | null {
	const o = row.offer;
	if (!o) return null;
	if (o.superseded) return "superseded";
	if (o.status === "accepted") return o.ordered ? "paid" : o.expired ? "expired" : "accepted";
	if (o.status === "pending") {
		if (o.expired) return "expired";
		return row.request_status === "answered" ? "pending" : "closed";
	}
	return o.status;
}

/** The acts the doors would accept from this viewer on this card's offer now. Pure. */
export function quoteCardActionsOf(row: QuoteCardRow): QuoteCardActionKind[] {
	const state = quoteCardStateOf(row);
	if (row.role === "buyer") {
		if (state === "pending") return ["accept_offer", "decline_offer"];
		if (state === "accepted" && row.request_status === "accepted") return ["checkout"];
		return [];
	}
	return state === "pending" ? ["withdraw_offer"] : [];
}

/** A `get_quote_cards` entry as a conversation renders it. Pure. */
export function quoteCardOf(row: QuoteCardRow): QuoteCardView {
	return {
		eventId: row.event_id,
		kind: row.kind,
		mine: row.by === row.role,
		at: row.at,
		role: row.role,
		requestId: row.request_id,
		listing: { title: row.listing_title, href: `/view/${row.listing_slug}` },
		freeRevisions: row.free_revisions,
		terms: row.terms && row.terms_hash
			? {
				offerId: row.terms.offer,
				scope: row.terms.scope,
				deliverables: row.terms.deliverables,
				priceMinor: row.terms.price_cents,
				currency: row.terms.currency,
				turnaroundDays: row.terms.turnaround_days,
				expiresAt: row.terms.expires_at,
				hash: row.terms_hash,
			}
			: null,
		state: quoteCardStateOf(row),
		intact: row.offer?.terms_intact ?? true,
		actions: quoteCardActionsOf(row),
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

/**
 * `POST /api/services/quotes` with `action: "issue"` — a seller's own quote from a conversation
 * (Decision #522), priced against one of their published services for the buyer behind `buyer`.
 */
export const IssueQuoteInputSchema = z.object({
	action: z.literal("issue"),
	/** The buyer, `@handle`. */
	buyer: z.string().trim().regex(/^@?[A-Za-z0-9_.-]{1,64}$/),
	/** The listing's `svc-` slug. */
	listing: z.string().trim().min(1).max(160),
	scope: SendQuoteOfferInputSchema.shape.scope,
	deliverables: SendQuoteOfferInputSchema.shape.deliverables,
	priceMinor: SendQuoteOfferInputSchema.shape.priceMinor,
	turnaroundDays: SendQuoteOfferInputSchema.shape.turnaroundDays,
	expiresInDays: SendQuoteOfferInputSchema.shape.expiresInDays,
});
export type IssueQuoteInput = z.infer<typeof IssueQuoteInputSchema>;

/** One service a seller may quote from a conversation: published, theirs, never a group session. */
export const QuotableListingSchema = z.object({
	slug: z.string().min(1).max(160),
	title: z.string().min(1).max(200),
	/** The listing's currency: a quote on it is priced in it. */
	currency: currencyCode,
});
export type QuotableListing = z.infer<typeof QuotableListingSchema>;

/** `GET /api/services/quotes/listings`. */
export const QuotableListingListSchema = z.object({ listings: z.array(QuotableListingSchema).max(60) });
export type QuotableListingList = z.infer<typeof QuotableListingListSchema>;

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
