import {
	type CohortCadence,
	cohortCadenceLabel,
	type CohortPhase,
	type ListingCohort,
	type ListingCohorts,
	type OpenCohortInput,
	OpenCohortInputSchema,
	previewCohortStarts,
} from "@projective/types/projects";
import type { CohortDialog } from "../types/catalogue-types.ts";

/**
 * cohort-model — the pure rules behind a group-session listing's Cohorts block in the workspace's
 * Availability section (Decision #498): where it reads and writes, what each cohort's line says, which
 * cohort a `?cohort=` address names, and the opening form's draft and the input it becomes. Clocks
 * and formatters come in as arguments, so every rule is testable without a DOM. The database decides
 * whether a cohort is under-filled or may be cancelled; nothing here derives either.
 */

// #region Paths
/** `/api/catalogue/cohorts?listing=`, plus the `clientPipeline` dev axis when one is set. */
export function cohortsPath(
	listing: string,
	sim: string | null = null,
	schedule: string | null = null,
): string {
	const q = new URLSearchParams({ listing });
	if (sim) q.set("sim", sim);
	if (schedule) q.set("schedule", schedule);
	return `/api/catalogue/cohorts?${q.toString()}`;
}

/** `/api/catalogue/cohorts/:cohortId/cancel`. */
export function cancelCohortPath(cohortId: string): string {
	return `/api/catalogue/cohorts/${encodeURIComponent(cohortId)}/cancel`;
}
// #endregion

// #region Addresses
/** The `?cohort=` value that confirms cancelling a cohort: its first sitting's slug. */
export function cancelAddress(cohort: ListingCohort): CohortDialog | null {
	const first = cohort.sittings[0];
	return first ? `cancel:${first.slug}` as CohortDialog : null;
}

/** The cohort a `?cohort=cancel:<ssn-…>` address names, when it is still one the seller may cancel. */
export function cohortForAddress(
	data: ListingCohorts | null,
	address: CohortDialog | undefined,
): ListingCohort | null {
	if (!data || !address || address === "open") return null;
	const slug = address.slice("cancel:".length);
	return data.cohorts.find((c) => c.canCancel && c.sittings[0]?.slug === slug) ?? null;
}

/** The cohort taking bookings now, if any — while one is, no other may open. */
export function enrollingCohort(data: ListingCohorts | null): ListingCohort | null {
	return data?.cohorts.find((c) => c.phase === "enrolling") ?? null;
}
// #endregion

// #region Copy
/** The lifecycle status a cohort's container carries (§B.11: a lifecycle status may be contained). */
export const COHORT_PHASE_LABEL: Readonly<Record<CohortPhase, string>> = {
	enrolling: "Taking bookings",
	closed: "Enrolment closed",
	running: "Running",
	cancelled: "Cancelled",
	completed: "Completed",
};

/** Formats an instant for the seller's own zone: "Tue 1 Dec, 18:00". */
export type InstantFormatter = (iso: string) => string;

/** "Tue 1 Dec, 18:00 · Weekly · 3 sessions" — when it starts and how it repeats. */
export function cohortWhenLine(cohort: ListingCohort, at: InstantFormatter): string {
	const cadence = cohortCadenceLabel(cohort.cadence, Math.max(1, cohort.sittings.length));
	return cohort.firstStartsAt ? `${at(cohort.firstStartsAt)} · ${cadence}` : cadence;
}

/** "2 of 12 seats booked · minimum 5" — the seats it has against the seats it needs. */
export function cohortSeatsLine(cohort: ListingCohort): string {
	const booked = `${cohort.seatsPaid} of ${cohort.maxSeats} ${
		cohort.maxSeats === 1 ? "seat" : "seats"
	} booked`;
	const held = cohort.seatsHeld > 0 ? ` · ${cohort.seatsHeld} held while buyers pay` : "";
	const min = cohort.minSeats !== null ? ` · minimum ${cohort.minSeats}` : "";
	return booked + held + min;
}

/** When enrolment closes or closed; `null` when the cohort has ended. */
export function cohortCloseLine(cohort: ListingCohort, at: InstantFormatter): string | null {
	if (!cohort.enrolmentClosesAt) return null;
	if (cohort.phase === "enrolling") return `Enrolment closes ${at(cohort.enrolmentClosesAt)}`;
	if (cohort.phase === "closed") return `Enrolment closed ${at(cohort.enrolmentClosesAt)}`;
	return null;
}

/** What the seller is told about a cancelled cohort. */
export function cancelledLine(cohort: ListingCohort): string {
	return cohort.cancelReason === "under_filled"
		? "Cancelled under its minimum; every seat was refunded in full."
		: "Cancelled before it started; every seat was refunded in full.";
}

/** The cancel confirmation's consequence, in words, before the press. */
export function cancelConsequence(cohort: ListingCohort): string {
	const seats = cohort.seatsPaid;
	const refund = seats === 0
		? "Nobody has booked a seat yet."
		: `${seats} ${seats === 1 ? "seat is" : "seats are"} refunded in full to ${
			seats === 1 ? "its buyer" : "their buyers"
		}.`;
	return `${refund} Its sessions come off your calendar, and the people on the waitlist keep their places.`;
}
// #endregion

// #region The opening form
/** The opening form as the seller fills it. Instants are local `Date`s; the server owns the truth. */
export interface CohortDraft {
	firstStart: Date | null;
	cadence: CohortCadence;
	/** Sittings 2…n, with the fixed cadence only. */
	laterStarts: (Date | null)[];
	maxSeats: number;
	/** `null`: the cohort runs whatever its size. */
	minSeats: number | null;
	closesAt: Date | null;
}

const HOUR = 3_600_000;

/** The first sitting a fresh form proposes: a week out, at 18:00 local time. */
export function defaultFirstStart(now: number): Date {
	const d = new Date(now);
	d.setDate(d.getDate() + 7);
	d.setHours(18, 0, 0, 0);
	return d;
}

/** A fresh draft for a listing: its cohort size, weekly, no minimum, closing a day before. */
export function freshDraft(
	data: Pick<ListingCohorts, "cohortSize" | "sessionCount">,
	now: number,
): CohortDraft {
	const first = defaultFirstStart(now);
	return {
		firstStart: first,
		cadence: "weekly",
		laterStarts: Array.from({ length: Math.max(0, data.sessionCount - 1) }, () => null),
		maxSeats: data.cohortSize,
		minSeats: null,
		closesAt: new Date(first.getTime() - 24 * HOUR),
	};
}

/** Every sitting's start as the form previews it; the database recomputes them in the provider's zone. */
export function draftStarts(draft: CohortDraft, sessionCount: number): string[] {
	if (!draft.firstStart) return [];
	const later = draft.laterStarts.map((d) => d?.toISOString() ?? "");
	return previewCohortStarts(
		draft.firstStart.toISOString(),
		sessionCount > 1 ? draft.cadence : null,
		sessionCount,
		later,
	);
}

/** The draft as the route's input, through the same Zod schema the route parses. */
export function draftToInput(
	listing: string,
	draft: CohortDraft,
	sessionCount: number,
): { ok: true; input: OpenCohortInput } | { ok: false; errors: Record<string, string> } {
	const errors: Record<string, string> = {};
	if (!draft.firstStart) errors.firstStartsAt = "Pick when the first session starts.";
	if (sessionCount > 1 && draft.cadence === "fixed") {
		draft.laterStarts.slice(0, sessionCount - 1).forEach((d, i) => {
			if (!d) errors[`laterStartsAt.${i}`] = `Pick when session ${i + 2} starts.`;
		});
	}
	if (Object.keys(errors).length > 0) return { ok: false, errors };
	const parsed = OpenCohortInputSchema.safeParse({
		listing,
		firstStartsAt: draft.firstStart!.toISOString(),
		cadence: sessionCount > 1 ? draft.cadence : null,
		laterStartsAt: sessionCount > 1 && draft.cadence === "fixed"
			? draft.laterStarts.slice(0, sessionCount - 1).map((d) => d!.toISOString())
			: [],
		maxSeats: draft.maxSeats,
		minSeats: draft.minSeats,
		enrolmentClosesAt: draft.closesAt?.toISOString() ?? null,
		name: null,
	});
	if (parsed.success) return { ok: true, input: parsed.data };
	for (const issue of parsed.error.issues) {
		const key = issue.path.map(String).join(".") || "form";
		if (!errors[key]) errors[key] = issue.message;
	}
	return { ok: false, errors };
}
// #endregion
