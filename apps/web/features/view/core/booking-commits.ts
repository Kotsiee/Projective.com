import type { ExploreItem } from "@projective/types/explore";
import type {
	ArchiveDraftInput,
	ContactActionInput,
	InstantiateServiceRequest,
	ServiceBriefInput,
	SessionBookingInput,
} from "@projective/types/services";
import type { CallType, SlotGrid, SlotPurpose } from "@projective/types/scheduling";
import { type BuyNowTarget, requestBuyNow } from "@web/features/checkout/core/buy-now-state.ts";
import { BookingService } from "./BookingService.ts";
import { getBooking } from "./api.ts";
import { toggleBasket } from "./basket-state.ts";
import { commitOrSimulate, simulating } from "./simulation.ts";

/**
 * booking-commits — every write a buyer can make from a listing page, each routed through the
 * simulation gate ({@link commitOrSimulate}). The lane, the buy bar, the booking modals and the
 * Contact popover call these rather than the services directly, so the owner's buyer simulation
 * (Decision #217 (j)) has ONE place where a commit either reaches the network or does not — and a
 * test can press every one of them with `fetch` stubbed. (The lane's Save goes through the same gate
 * in place: `saved-state` reaches `utils/dev.ts`, which only loads under Vite.)
 */

// #region Commits
/** Add a pipeline listing to the buyer's projects as a draft. */
export function commitPipeline(input: InstantiateServiceRequest) {
	return commitOrSimulate(
		{ kind: "instantiate_pipeline" },
		() => BookingService.instantiatePipeline(input),
	);
}

/** Archive the buyer's draft of a pipeline listing. */
export function commitArchiveDraft(input: ArchiveDraftInput) {
	return commitOrSimulate({ kind: "archive_draft" }, () => BookingService.archiveDraft(input));
}

/** Reserve the chosen time (or seat) and stage the booking for checkout. */
export function commitSession(input: SessionBookingInput) {
	return commitOrSimulate(
		{ kind: "book_session", seats: input.seats },
		() => BookingService.bookSession(input),
	);
}

/** Stage a scoped engagement (One-Off / Single Task) for checkout. */
export function commitConfigure(input: ServiceBriefInput) {
	return commitOrSimulate(
		{ kind: "configure", wholeEngagement: input.fundingScope === "whole_project" },
		() => BookingService.configure(input),
	);
}

/**
 * A Contact Me action — a discovery call, a question or a custom quote. `callMinutes` is the call's
 * length as the modal showed it, so the simulated outcome can name it.
 */
export function commitContact(input: ContactActionInput, callMinutes: number | null = null) {
	const commit = input.kind === "discovery_call"
		? { kind: "discovery_call" as const, minutes: callMinutes }
		: input.kind === "custom_quote"
		? { kind: "custom_quote" as const }
		: { kind: "ask_question" as const };
	return commitOrSimulate(commit, () => BookingService.contact(input));
}

/** Add the listing to the basket, or take it out. */
export function commitBasket(item: ExploreItem) {
	return commitOrSimulate({ kind: "add_to_basket" }, () => toggleBasket(item));
}

/**
 * Instant checkout. Opening the Buy-Now panel IS the commit: it adds the line to a basket and opens a
 * checkout session the moment it mounts, so in a simulation the panel never opens.
 */
export function commitBuyNow(target: BuyNowTarget, authed: boolean) {
	return commitOrSimulate({ kind: "buy_now" }, () => {
		requestBuyNow(target, authed);
		return Promise.resolve();
	});
}
// #endregion

// #region Reads
/** The parameters of a slot-grid read. */
export interface SlotRead {
	subjectId: string;
	purpose: SlotPurpose;
	timezone?: string;
	from?: number;
	days?: number;
	callType?: CallType;
}

/**
 * A window of the bookable slot grid. A simulated page reads it from the owner's simulation route
 * (`/api/catalogue/simulate/slots`), because the public read cannot see a listing that is not yet
 * published; the grid is the same.
 */
export function readSlots(params: SlotRead) {
	if (!simulating.peek()) return BookingService.slots(params);
	const qs = new URLSearchParams({ subjectId: params.subjectId, purpose: params.purpose });
	if (params.timezone) qs.set("timezone", params.timezone);
	if (params.from !== undefined) qs.set("from", String(params.from));
	if (params.days !== undefined) qs.set("days", String(params.days));
	if (params.callType) qs.set("callType", params.callType);
	return getBooking<{ grid: SlotGrid }>(`/api/catalogue/simulate/slots?${qs.toString()}`);
}
// #endregion
