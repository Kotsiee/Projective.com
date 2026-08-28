import { getBooking, postBooking } from "./api.ts";
import type { BookingResult } from "./respond.ts";
import type { SlotGrid, SlotPurpose } from "@projective/types/scheduling";
import type {
	ArchiveDraftInput,
	BookingOutcome,
	ContactActionInput,
	ContactActionResult,
	InstantiateServiceInput,
	PipelineDraft,
	ServiceBookingOffer,
	ServiceBriefInput,
	ServiceSim,
	SessionBookingInput,
} from "@projective/types/services";
import { serviceSimToQuery } from "@projective/types/services";

/**
 * BookingService — the THIN client service every conversion CTA on a listing page talks to.
 *
 * It builds the query string or the body and delegates to {@link getBooking} / {@link postBooking}. It
 * touches no database, resolves no price, and decides nothing: a refusal comes back with
 * `errors.<field>` naming the control that refused it, and the surface renders the server's own
 * sentence rather than re-deriving one. That is the islands-are-dumb boundary, and it is what lets the
 * same modal serve four booking flows without knowing any of their rules.
 *
 * Every method takes the optional developer simulation overlay, which travels as `sim*` query params.
 * In production it is always `undefined` (the seam tree-shakes out), so a request is byte-identical to
 * one from before the seam existed.
 */
export const BookingService = {
	/**
	 * Re-read the resolved offer.
	 *
	 * The listing page SSRs this, so the island only calls it when something the server could not have
	 * seen has changed — a dev-seam flip, or a write that moved the offer (instantiating a pipeline
	 * flips the primary to "Open Project →").
	 */
	offer(
		subjectId: string,
		opts: { handle?: string | null; sim?: ServiceSim } = {},
	): Promise<BookingResult<{ offer: ServiceBookingOffer }>> {
		const qs = new URLSearchParams({ subjectId });
		if (opts.handle) qs.set("handle", opts.handle);
		return getBooking<{ offer: ServiceBookingOffer }>(
			`/api/services/offer?${qs.toString()}${serviceSimToQuery(opts.sim)}`,
		);
	},

	/**
	 * A window of the bookable slot grid.
	 *
	 * `timezone` is the viewer's own IANA id, read from `Intl` at the call site rather than guessed
	 * server-side: a server that guessed would bucket a buyer's days into a calendar they do not live
	 * in, which is the single most expensive error a booking surface can make.
	 */
	slots(
		params: {
			subjectId: string;
			purpose: SlotPurpose;
			timezone?: string;
			from?: number;
			days?: number;
		},
		sim?: ServiceSim,
	): Promise<BookingResult<{ grid: SlotGrid }>> {
		const qs = new URLSearchParams({ subjectId: params.subjectId, purpose: params.purpose });
		if (params.timezone) qs.set("timezone", params.timezone);
		if (params.from !== undefined) qs.set("from", String(params.from));
		if (params.days !== undefined) qs.set("days", String(params.days));
		return getBooking<{ grid: SlotGrid }>(
			`/api/services/slots?${qs.toString()}${serviceSimToQuery(sim)}`,
		);
	},

	/** Reserve the chosen slot(s) and stage the booking for checkout. */
	bookSession(
		input: SessionBookingInput,
		sim?: ServiceSim,
	): Promise<BookingResult<{ outcome: BookingOutcome }>> {
		return postBooking<{ outcome: BookingOutcome }>(
			`/api/services/book-session${queryOnly(sim)}`,
			input,
		);
	},

	/** Stage a scoped engagement (One-Off / Single Task) for checkout. */
	configure(input: ServiceBriefInput): Promise<BookingResult<{ outcome: BookingOutcome }>> {
		return postBooking<{ outcome: BookingOutcome }>("/api/services/configure", input);
	},

	/** Perform a Contact Me action — a discovery call, a question, or a custom quote. */
	contact(
		input: ContactActionInput,
		sim?: ServiceSim,
	): Promise<BookingResult<{ result: ContactActionResult }>> {
		return postBooking<{ result: ContactActionResult }>(
			`/api/services/contact-action${queryOnly(sim)}`,
			input,
		);
	},

	/** Instantiate a pipeline template into the acting client's workspace as a draft project. */
	instantiatePipeline(
		input: InstantiateServiceInput,
	): Promise<BookingResult<{ draft: PipelineDraft; created: boolean }>> {
		return postBooking<{ draft: PipelineDraft; created: boolean }>(
			"/api/services/instantiate-pipeline",
			input,
		);
	},

	/** Soft-archive a draft pipeline. Never a delete — nothing here is hard-deleted. */
	archiveDraft(input: ArchiveDraftInput): Promise<BookingResult<{ draft: PipelineDraft }>> {
		return postBooking<{ draft: PipelineDraft }>("/api/services/archive-draft", input);
	},
};

/**
 * The simulation overlay as a standalone query string.
 *
 * {@link serviceSimToQuery} emits a LEADING `&` because every READ call site appends it to a URL that
 * already carries a scope param. A POST has no other param, so the separator has to be flipped — and
 * doing it here rather than at three call sites is what stops one of them shipping `?&simCallOffer=`.
 */
function queryOnly(sim?: ServiceSim): string {
	const q = serviceSimToQuery(sim);
	return q ? `?${q.slice(1)}` : "";
}
