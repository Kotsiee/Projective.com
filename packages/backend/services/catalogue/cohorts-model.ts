import {
	COHORT_SITTINGS_MAX,
	CohortCadenceSchema,
	type CohortCancellation,
	CohortCancelReasonSchema,
	CohortPhaseSchema,
	CohortStatusSchema,
	type ListingCohort,
	type ListingCohorts,
	type ListingCohortSitting,
} from "@projective/types/projects";
import type { ClientPipelineSim } from "./clients-fixtures.ts";

/**
 * The pure half of a group-session listing's cohorts as its seller reads them (Decision #498): the
 * raw shapes `projects.get_listing_cohorts` and `projects.cancel_cohort` answer, their mapping onto the
 * Zod SSOT, and the fixture world `dev:mock` serves through the same mapping, shaped by the
 * `clientPipeline` dev axis (empty → no cohort yet · action_required → one that closed under its
 * minimum · busy / auto → one taking bookings).
 */

// #region Raw shapes
/** One sitting as `get_listing_cohorts` hands it over. */
export interface RawListingCohortSitting {
	sitting_id: string;
	slug: string;
	title: string;
	starts_at: string;
	ends_at: string;
	status: string;
}

/** One cohort as `get_listing_cohorts` hands it over. */
export interface RawListingCohort {
	cohort_id: string;
	name: string;
	status: string;
	phase: string;
	max_seats: number;
	min_seats: number | null;
	seats_paid: number;
	seats_held: number;
	enrolment_closes_at: string | null;
	cadence: string | null;
	first_start: string | null;
	last_end: string | null;
	under_filled: boolean | null;
	can_cancel: boolean | null;
	cancel_reason: string | null;
	cancelled_at: string | null;
	project_slug: string | null;
	sittings: RawListingCohortSitting[] | null;
}

/** `projects.get_listing_cohorts`'s answer. */
export interface RawListingCohorts {
	session_count: number | null;
	session_minutes: number | null;
	cohort_size: number | null;
	cohorts: RawListingCohort[] | null;
}

/** `projects.cancel_cohort`'s answer. */
export interface RawCohortCancellation {
	cohort_id: string;
	reason: string;
	seats_refunded: number | null;
	refunded_minor: number | null;
	currency: string | null;
	places_restored: number | null;
	waitlist_told: number | null;
}
// #endregion

// #region Mapping
function isoOf(value: string | null | undefined): string | null {
	if (!value) return null;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function clamp(n: number | null | undefined, min: number, max: number, fallback: number): number {
	return typeof n === "number" && Number.isFinite(n)
		? Math.min(max, Math.max(min, Math.trunc(n)))
		: fallback;
}

function sittingOf(raw: RawListingCohortSitting): ListingCohortSitting[] {
	const startsAt = isoOf(raw.starts_at);
	const endsAt = isoOf(raw.ends_at);
	if (!startsAt || !endsAt) return [];
	return [{
		id: raw.sitting_id,
		slug: raw.slug,
		title: raw.title.slice(0, 200),
		startsAt,
		endsAt,
		status: raw.status,
	}];
}

/** One raw cohort onto the seller's view; a row the SSOT cannot read is dropped, never guessed. */
export function toListingCohort(raw: RawListingCohort): ListingCohort | null {
	const status = CohortStatusSchema.safeParse(raw.status);
	const phase = CohortPhaseSchema.safeParse(raw.phase);
	if (!status.success || !phase.success) return null;
	const maxSeats = clamp(raw.max_seats, 1, 500, 1);
	return {
		cohortId: raw.cohort_id,
		name: raw.name.slice(0, 200),
		status: status.data,
		phase: phase.data,
		maxSeats,
		minSeats: typeof raw.min_seats === "number" ? clamp(raw.min_seats, 1, maxSeats, 1) : null,
		seatsPaid: clamp(raw.seats_paid, 0, 500, 0),
		seatsHeld: clamp(raw.seats_held, 0, 500, 0),
		enrolmentClosesAt: isoOf(raw.enrolment_closes_at),
		cadence: CohortCadenceSchema.safeParse(raw.cadence).data ?? null,
		firstStartsAt: isoOf(raw.first_start),
		lastEndsAt: isoOf(raw.last_end),
		underFilled: raw.under_filled === true,
		canCancel: raw.can_cancel === true,
		cancelReason: CohortCancelReasonSchema.safeParse(raw.cancel_reason).data ?? null,
		cancelledAt: isoOf(raw.cancelled_at),
		projectSlug: raw.project_slug,
		sittings: (raw.sittings ?? []).flatMap(sittingOf).slice(0, COHORT_SITTINGS_MAX),
	};
}

/** `get_listing_cohorts` onto the seller's view of the listing's cohorts. */
export function toListingCohorts(raw: RawListingCohorts): ListingCohorts {
	return {
		sessionCount: clamp(raw.session_count, 1, COHORT_SITTINGS_MAX, 1),
		sessionMinutes: clamp(raw.session_minutes, 5, 600, 60),
		cohortSize: clamp(raw.cohort_size, 1, 500, 1),
		cohorts: (raw.cohorts ?? []).flatMap((c) => {
			const one = toListingCohort(c);
			return one ? [one] : [];
		}).slice(0, 20),
	};
}

/** `cancel_cohort` onto what the seller is told it did. */
export function toCohortCancellation(raw: RawCohortCancellation): CohortCancellation {
	return {
		cohortId: raw.cohort_id,
		reason: CohortCancelReasonSchema.safeParse(raw.reason).data ?? "provider",
		seatsRefunded: clamp(raw.seats_refunded, 0, 100_000, 0),
		refundedMinor: clamp(raw.refunded_minor, 0, Number.MAX_SAFE_INTEGER, 0),
		currency: raw.currency && /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : null,
		placesRestored: clamp(raw.places_restored, 0, 100_000, 0),
		waitlistTold: clamp(raw.waitlist_told, 0, 100_000, 0),
	};
}
// #endregion

// #region Fixtures
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function fixtureId(n: number): string {
	return `00000000-0000-4000-8c00-${String(n).padStart(12, "0")}`;
}

function fixtureSlug(n: number): string {
	return `ssn-abcdefghj${"23456789ab"[n % 10]}`;
}

/**
 * The fixture world's cohorts for one listing, as `get_listing_cohorts` would answer them: none on
 * `empty`; one whose enrolment closed below its minimum on `action_required`; otherwise one taking
 * bookings, three sittings a week apart.
 */
export function fixtureListingCohorts(
	sim: ClientPipelineSim,
	now: number,
	listing: { title: string; cohortSize?: number; sessionCount?: number },
): RawListingCohorts {
	const size = listing.cohortSize ?? 12;
	const count = listing.sessionCount ?? 3;
	const base: RawListingCohorts = {
		session_count: count,
		session_minutes: 120,
		cohort_size: size,
		cohorts: [],
	};
	if (sim === "empty") return base;
	const closed = sim === "action_required";
	const firstStart = Math.floor((now + (closed ? 2 : 9) * DAY) / HOUR) * HOUR;
	const sittings = Array.from({ length: count }, (_, k): RawListingCohortSitting => ({
		sitting_id: fixtureId(100 + k),
		slug: fixtureSlug(k),
		title: count === 1 ? listing.title : `${listing.title} — session ${k + 1} of ${count}`,
		starts_at: new Date(firstStart + k * 7 * DAY).toISOString(),
		ends_at: new Date(firstStart + k * 7 * DAY + 2 * HOUR).toISOString(),
		status: "scheduled",
	}));
	const min = Math.min(5, size);
	return {
		...base,
		cohorts: [{
			cohort_id: fixtureId(1),
			name: listing.title,
			status: closed ? "active" : "enrolling",
			phase: closed ? "closed" : "enrolling",
			max_seats: size,
			min_seats: min,
			seats_paid: closed ? Math.max(0, min - 3) : Math.min(size, 4),
			seats_held: closed ? 0 : 1,
			enrolment_closes_at: new Date(closed ? now - 2 * HOUR : firstStart - 24 * HOUR).toISOString(),
			cadence: count > 1 ? "weekly" : null,
			first_start: sittings[0].starts_at,
			last_end: sittings[sittings.length - 1].ends_at,
			under_filled: closed,
			can_cancel: true,
			cancel_reason: null,
			cancelled_at: null,
			project_slug: null,
			sittings,
		}],
	};
}
// #endregion
