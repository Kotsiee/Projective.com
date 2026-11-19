import {
	type IntakeAnswers,
	type IssueQuoteInput,
	type QuoteActInput,
	type QuoteActResult,
	type QuoteCardList,
	quoteCardOf,
	QuoteCardRowSchema,
	type QuoteList,
	type QuoteView,
	quoteViewOf,
	type QuoteWithRow,
	QuoteWithRowSchema,
	type QuotableListingList,
} from "@projective/types/services";
import { z } from "zod";
import type { SupabaseClient } from "supabaseClient";
import { getUserClient, useMocks } from "../../core/supabase.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";

/**
 * QuoteBackendService — custom quote requests and the host's priced offers (Decision #458).
 *
 * Every write is one door in `00001177_functions_marketplace_quotes.sql`, run with the caller's own
 * token: the door decides who may act and from which state, and this service only turns its
 * `Quote refused: <code>` into a sentence and the control it concerns. Nothing here moves money —
 * an accept puts one basket line in, and checkout prices it from the offer.
 */

// #region Actor
/** Who is acting: their id and the session token the doors evaluate `auth.uid()` from. */
export interface QuoteActor {
	userId: string | null;
	accessToken?: string | null;
}
// #endregion

// #region Refusals
interface Refusal {
	status: number;
	message: string;
	field?: string;
}

const REFUSALS: Record<string, Refusal> = {
	not_signed_in: { status: 401, message: "Sign in to continue." },
	quote_not_found: { status: 404, message: "That quote request could not be found." },
	not_your_move: { status: 403, message: "That isn't yours to answer." },
	not_open: { status: 409, message: "This request has moved on. Refresh to see where it stands." },
	listing_unavailable: {
		status: 409,
		field: "subjectId",
		message: "That service is no longer available.",
	},
	own_listing: { status: 422, field: "handle", message: "That is your own listing." },
	scope_required: { status: 422, field: "scope", message: "Describe the scope." },
	budget_invalid: { status: 422, field: "budgetMinor", message: "Enter a budget of zero or more." },
	currency_required: { status: 422, field: "currency", message: "Add a currency for that budget." },
	timeline_too_long: {
		status: 422,
		field: "timeline",
		message: "Keep the timeline to 200 characters.",
	},
	already_open: {
		status: 409,
		field: "subjectId",
		message:
			"You already have an open quote request for this service. The seller's answer will reach you in Messages.",
	},
	too_many_deliverables: {
		status: 422,
		field: "deliverables",
		message: "List at most 12 deliverables.",
	},
	deliverable_too_long: {
		status: 422,
		field: "deliverables",
		message: "Keep each deliverable to 160 characters.",
	},
	price_required: { status: 422, field: "priceMinor", message: "Set a price above zero." },
	turnaround_invalid: {
		status: 422,
		field: "turnaroundDays",
		message: "Set a turnaround of 1 to 90 days.",
	},
	expiry_invalid: {
		status: 422,
		field: "expiresInDays",
		message: "Keep the offer open for 3 to 30 days.",
	},
	offer_expired: {
		status: 409,
		field: "offerId",
		message: "This offer has expired. Ask the seller for a new one.",
	},
	already_ordered: { status: 409, message: "This offer has already been paid for." },
	offer_not_accepted: { status: 409, message: "Accept the offer before paying for it." },
	group_session: {
		status: 422,
		field: "subjectId",
		message: "Group sessions are booked by the seat, so they take no custom quotes.",
	},
	answers_invalid: { status: 422, field: "answers", message: "Those answers could not be read." },
	buyer_unavailable: { status: 404, field: "buyer", message: "That person could not be found." },
	buyer_restricted: {
		status: 422,
		field: "buyer",
		message: "That person can't buy until their 18th birthday.",
	},
	not_your_listing: { status: 403, field: "listing", message: "Quote one of your own published services." },
	no_conversation: {
		status: 422,
		field: "buyer",
		message: "You can send a quote once they have written to you.",
	},
	terms_mismatch: {
		status: 409,
		message: "These terms no longer match what was agreed. Contact support before paying.",
	},
	terms_frozen: { status: 409, message: "A sent offer can't be changed. Send a revised offer instead." },
	record_kept: { status: 409, message: "The quote record can't be changed." },
	too_many_cards: { status: 422, message: "Ask for at most 100 quote cards at once." },
};

const RESTRICTED: Refusal = {
	status: 403,
	message: "Buying and selling unlock on your 18th birthday.",
};

/** The refusal a door's error stands for, or `null` when it is not one of the doors' own. */
export function quoteRefusalOf(error: { code?: string; message?: string }): Refusal | null {
	if (error.code === "PM403") return RESTRICTED;
	const match = /Quote refused: ([a-z_]+)/.exec(error.message ?? "");
	return match ? REFUSALS[match[1]] ?? null : null;
}

function refuse<T>(refusal: Refusal): ServiceResult<T> {
	return fail(refusal.status, {
		message: refusal.message,
		errors: refusal.field ? { [refusal.field]: refusal.message } : undefined,
	});
}

/** A door's error as a result: its refusal when it is one, else a logged 503. */
function failure<T>(error: { code?: string; message?: string }, what: string): ServiceResult<T> {
	const refusal = quoteRefusalOf(error);
	if (refusal) return refuse(refusal);
	console.error(`[quotes] ${what} failed`, error.code, error.message);
	return fail(503, { message: "That didn't go through. Please try again." });
}
// #endregion

/** Quotes are live-only: under `USE_MOCKS` (no database) every entry answers this 503. */
const OFFLINE = "Quotes aren't available in this environment.";

// #region Reads
function marketplace(token: string): SupabaseClient {
	return getUserClient(token).schema("marketplace") as unknown as SupabaseClient;
}

/** The user id behind a `@handle`, or `null` when nobody has it. */
async function userIdOf(token: string, handle: string): Promise<string | null | undefined> {
	const { data, error } = await getUserClient(token).schema("org").from("users_public")
		.select("user_id")
		.eq("username", handle.replace(/^@+/, ""))
		.maybeSingle();
	if (error) {
		console.error("[quotes] handle lookup failed", error.message);
		return undefined;
	}
	return (data as { user_id: string } | null)?.user_id ?? null;
}

/** Every request between the caller and one person, parsed and mapped. */
async function quotesWith(token: string, counterpartId: string): Promise<QuoteView[] | null> {
	const { data, error } = await marketplace(token).rpc("get_quotes_with", {
		p_counterpart: counterpartId,
	});
	if (error) {
		console.error("[quotes] get_quotes_with failed", error.code, error.message);
		return null;
	}
	const rows = z.array(QuoteWithRowSchema).safeParse(data ?? []);
	if (!rows.success) {
		console.error("[quotes] get_quotes_with answered an unexpected shape", rows.error.message);
		return null;
	}
	return rows.data.map((r: QuoteWithRow) => quoteViewOf(r));
}

/** The two parties of a request the caller can see, or `null`. */
async function partiesOf(
	token: string,
	requestId: string,
): Promise<{ host: string; requester: string } | null> {
	const { data } = await marketplace(token).from("quote_requests")
		.select("host_user_id, requester_user_id")
		.eq("id", requestId)
		.maybeSingle();
	const row = data as { host_user_id: string; requester_user_id: string } | null;
	return row ? { host: row.host_user_id, requester: row.requester_user_id } : null;
}
// #endregion

// #region Acts
/** The door each act runs, and the arguments it takes. */
function doorOf(
	requestId: string,
	input: QuoteActInput,
): { fn: string; args: Record<string, unknown> } {
	switch (input.action) {
		case "send_offer":
			return {
				fn: "send_quote_offer",
				args: {
					p_request: requestId,
					p_scope: input.scope,
					p_deliverables: input.deliverables,
					p_price_cents: input.priceMinor,
					p_turnaround_days: input.turnaroundDays,
					p_expires_in_days: input.expiresInDays,
				},
			};
		case "withdraw_offer":
			return { fn: "withdraw_quote_offer", args: { p_offer: input.offerId } };
		case "accept_offer":
			return { fn: "accept_quote_offer", args: { p_offer: input.offerId } };
		case "decline_offer":
			return { fn: "decline_quote_offer", args: { p_offer: input.offerId } };
		case "decline_request":
			return {
				fn: "decline_quote_request",
				args: { p_request: requestId, p_reason: input.reason ?? null },
			};
		case "withdraw_request":
			return { fn: "withdraw_quote_request", args: { p_request: requestId } };
	}
}

const CONFIRMATIONS: Record<QuoteActInput["action"], string> = {
	send_offer: "Offer sent. They have until it expires to accept it.",
	withdraw_offer: "Offer withdrawn.",
	accept_offer: "Offer accepted. It is in your basket; nothing is charged until you pay.",
	decline_offer: "Offer declined. The seller can send another.",
	decline_request: "Request declined.",
	withdraw_request: "Request withdrawn.",
};
// #endregion

export const QuoteBackendService = {
	/** Every quote request between the caller and the person behind `handle`, in either role. */
	async listWith(handle: string, actor: QuoteActor): Promise<ServiceResult<QuoteList>> {
		if (!actor.userId || !actor.accessToken) return refuse(REFUSALS.not_signed_in);
		if (useMocks()) return fail(503, { message: OFFLINE });
		const counterpart = await userIdOf(actor.accessToken, handle);
		if (counterpart === undefined) {
			return fail(503, { message: "Quotes could not be loaded just now." });
		}
		if (!counterpart || counterpart === actor.userId) return ok({ quotes: [] });
		const quotes = await quotesWith(actor.accessToken, counterpart);
		if (!quotes) return fail(503, { message: "Quotes could not be loaded just now." });
		return ok({ quotes });
	},

	/**
	 * One act on one request, through its door, answered with the request as it now stands. An accept
	 * also names the basket holding the offer's line, so the surface can go on to checkout.
	 */
	async act(
		requestId: string,
		input: QuoteActInput,
		actor: QuoteActor,
	): Promise<ServiceResult<QuoteActResult>> {
		if (!actor.userId || !actor.accessToken) return refuse(REFUSALS.not_signed_in);
		if (useMocks()) return fail(503, { message: OFFLINE });
		const token = actor.accessToken;
		const parties = await partiesOf(token, requestId);
		if (!parties) return refuse(REFUSALS.quote_not_found);

		const { fn, args } = doorOf(requestId, input);
		const { data, error } = await marketplace(token).rpc(fn, args);
		if (error) return failure(error, fn);
		const answer = (data ?? {}) as { basket_id?: string | null };

		const counterpart = parties.host === actor.userId ? parties.requester : parties.host;
		const quote = (await quotesWith(token, counterpart))?.find((q) => q.id === requestId);
		if (!quote) {
			return fail(503, {
				message: "Done, but the request could not be re-read. Refresh to see it.",
			});
		}
		return ok({
			quote,
			confirmation: CONFIRMATIONS[input.action],
			basketId: input.action === "accept_offer" ? answer.basket_id ?? null : null,
		});
	},

	/**
	 * Raise a request against a published service (`marketplace.request_quote`), which addresses it to
	 * the listing's seller and tells them. The answers are already held to the listing's questions by
	 * the caller. Answers the new request's id.
	 */
	async request(
		input: {
			blueprintId: string;
			scope: string;
			budgetMinor?: number;
			currency?: string;
			timeline?: string;
			answers?: IntakeAnswers;
		},
		actor: QuoteActor,
	): Promise<ServiceResult<{ id: string }>> {
		if (!actor.userId || !actor.accessToken) return refuse(REFUSALS.not_signed_in);
		if (useMocks()) return fail(503, { message: OFFLINE });
		const { data, error } = await marketplace(actor.accessToken).rpc("request_quote", {
			p_blueprint: input.blueprintId,
			p_scope: input.scope,
			p_budget_cents: input.budgetMinor ?? null,
			p_currency: input.budgetMinor !== undefined ? input.currency ?? null : null,
			p_timeline: input.timeline ?? null,
			p_answers: input.answers ?? {},
		});
		if (error) return failure(error, "request_quote");
		return ok({ id: (data as { id: string }).id }, { status: 201 });
	},

	/**
	 * A seller's own quote from a conversation (`marketplace.issue_quote`, Decision #522): one of their
	 * published services, priced for a buyer who has written to them. Answers the request it now
	 * stands on, as the seller sees it.
	 */
	async issue(input: IssueQuoteInput, actor: QuoteActor): Promise<ServiceResult<QuoteActResult>> {
		if (!actor.userId || !actor.accessToken) return refuse(REFUSALS.not_signed_in);
		if (useMocks()) return fail(503, { message: OFFLINE });
		const token = actor.accessToken;
		const buyer = await userIdOf(token, input.buyer);
		if (buyer === undefined) return fail(503, { message: "That didn't go through. Please try again." });
		if (!buyer) return refuse(REFUSALS.buyer_unavailable);
		const blueprintId = await blueprintOf(token, input.listing);
		if (blueprintId === undefined) return fail(503, { message: "That didn't go through. Please try again." });
		if (!blueprintId) return refuse(REFUSALS.not_your_listing);

		const { data, error } = await marketplace(token).rpc("issue_quote", {
			p_counterpart: buyer,
			p_blueprint: blueprintId,
			p_scope: input.scope,
			p_deliverables: input.deliverables,
			p_price_cents: input.priceMinor,
			p_turnaround_days: input.turnaroundDays,
			p_expires_in_days: input.expiresInDays,
		});
		if (error) return failure(error, "issue_quote");
		const requestId = (data as { quote_request_id: string }).quote_request_id;
		const quote = (await quotesWith(token, buyer))?.find((q) => q.id === requestId);
		if (!quote) {
			return fail(503, { message: "Sent, but the quote could not be re-read. Refresh to see it." });
		}
		return ok({
			quote,
			confirmation: "Quote sent. It appears in your conversation, and they have until it expires to accept it.",
			basketId: null,
		}, { status: 201 });
	},

	/**
	 * The services the caller may quote from a conversation (Decision #522): their own published
	 * listings, never a group session — the set `marketplace.issue_quote` accepts. Newest first.
	 */
	async quotableListings(actor: QuoteActor): Promise<ServiceResult<QuotableListingList>> {
		if (!actor.userId || !actor.accessToken) return refuse(REFUSALS.not_signed_in);
		if (useMocks()) return ok({ listings: [] });
		const { data, error } = await marketplace(actor.accessToken).from("service_blueprints")
			.select("slug, title, currency")
			.eq("freelancer_profile_id", actor.userId)
			.eq("is_published", true)
			.neq("delivery_model", "group_session")
			.order("created_at", { ascending: false })
			.limit(60);
		if (error) {
			console.error("[quotes] quotable listings failed", error.code, error.message);
			return fail(503, { message: "Your services could not be loaded just now." });
		}
		const rows = (data ?? []) as { slug: string; title: string; currency: string }[];
		return ok({
			listings: rows.map((r) => ({ slug: r.slug, title: r.title, currency: r.currency.toUpperCase() })),
		});
	},

	/**
	 * The quote cards a conversation renders (`marketplace.get_quote_cards`, Decision #522), for the
	 * event ids its messages carry. Ids the caller is not a party to are left out.
	 */
	async cards(eventIds: readonly string[], actor: QuoteActor): Promise<ServiceResult<QuoteCardList>> {
		if (!actor.userId || !actor.accessToken) return refuse(REFUSALS.not_signed_in);
		if (useMocks()) return ok({ cards: [] });
		if (eventIds.length === 0) return ok({ cards: [] });
		const { data, error } = await marketplace(actor.accessToken).rpc("get_quote_cards", {
			p_events: [...new Set(eventIds)],
		});
		if (error) return failure(error, "get_quote_cards");
		const rows = z.array(QuoteCardRowSchema).safeParse(data ?? []);
		if (!rows.success) {
			console.error("[quotes] get_quote_cards answered an unexpected shape", rows.error.message);
			return fail(503, { message: "Quote cards could not be loaded just now." });
		}
		return ok({ cards: rows.data.map(quoteCardOf) });
	},
};

/** The blueprint behind a service listing's `svc-` slug, or `null` when there is none. */
async function blueprintOf(token: string, listing: string): Promise<string | null | undefined> {
	const { data, error } = await marketplace(token).from("service_blueprints")
		.select("id")
		.eq("slug", listing)
		.maybeSingle();
	if (error) {
		console.error("[quotes] listing lookup failed", error.message);
		return undefined;
	}
	return (data as { id: string } | null)?.id ?? null;
}
