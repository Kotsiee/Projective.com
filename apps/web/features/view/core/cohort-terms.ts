import { cohortCadenceLabel, type CohortOffer } from "@projective/types/projects";
import { sittingLabel } from "./sitting-time.ts";

/**
 * cohort-terms — what a group session's purchase card must disclose before a seat is bought (PRODUCT_SPEC
 * §The Entity View, "the cohort start and cadence for a Group Session"; Decision #498): when the cohort
 * starts and how its sessions repeat, when enrolment closes, and the minimum it runs with, with what
 * happens below it. Pure: the zone comes in, and with none (the first byte) times read in UTC and say so.
 */

/** One key-terms row, in the lane ledger's shape: the fact, and an optional qualifier under it. */
export interface CohortTermRow {
	label: string;
	value: string;
	note?: string;
}

/** "Mon 30 Nov, 18:00" in the zone, or in UTC (saying so) without one. */
export function instantLabel(iso: string, zone: string | null, locale?: string): string {
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return "";
	let timeZone = zone ?? "UTC";
	try {
		new Intl.DateTimeFormat(locale, { timeZone });
	} catch {
		timeZone = "UTC";
	}
	const text = new Intl.DateTimeFormat(locale, {
		timeZone,
		weekday: "short",
		day: "numeric",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
	}).format(at);
	return timeZone === "UTC" && zone !== "UTC" ? `${text} UTC` : text;
}

/** The cohort's terms as key-terms rows; empty without a cohort. */
export function cohortTermRows(cohort: CohortOffer | null, zone: string | null): CohortTermRow[] {
	if (!cohort) return [];
	const rows: CohortTermRow[] = [];
	const first = cohort.sittings[0];
	if (first) {
		rows.push({
			label: "Starts",
			value: sittingLabel(first.startsAt, first.endsAt, zone),
			note: cohortCadenceLabel(cohort.cadence, Math.max(1, cohort.sittings.length)),
		});
	}
	if (cohort.enrolmentClosesAt) {
		rows.push({
			label: "Enrolment",
			value: `Closes ${instantLabel(cohort.enrolmentClosesAt, zone)}`,
		});
	}
	if (cohort.minSeats !== null) {
		rows.push({
			label: "Minimum",
			value: `${cohort.minSeats} ${cohort.minSeats === 1 ? "seat" : "seats"}`,
			note:
				"If fewer book before enrolment closes, it may be cancelled and every seat refunded in full",
		});
	}
	return rows;
}

/** The minimum and what happens below it, for the seat panel under its sittings; `null` without one. */
export function cohortMinimumSentence(
	cohort: CohortOffer | null,
	zone: string | null,
): string | null {
	if (!cohort || cohort.minSeats === null) return null;
	const by = cohort.enrolmentClosesAt ? ` by ${instantLabel(cohort.enrolmentClosesAt, zone)}` : "";
	return `This cohort runs with at least ${cohort.minSeats} ${
		cohort.minSeats === 1 ? "seat" : "seats"
	}. If fewer are booked${by}, it may be cancelled, and every seat is refunded in full.`;
}

/** The same terms as one sentence, for the phone's buy bar; `null` without a cohort. */
export function cohortTermsSentence(
	cohort: CohortOffer | null,
	zone: string | null,
): string | null {
	if (!cohort) return null;
	const parts: string[] = [];
	const first = cohort.sittings[0];
	if (first) {
		parts.push(
			`Starts ${sittingLabel(first.startsAt, first.endsAt, zone)} · ${
				cohortCadenceLabel(cohort.cadence, Math.max(1, cohort.sittings.length))
			}.`,
		);
	}
	if (cohort.minSeats !== null && cohort.enrolmentClosesAt) {
		parts.push(
			`Runs with at least ${cohort.minSeats} ${
				cohort.minSeats === 1 ? "seat" : "seats"
			}; if fewer book by ${
				instantLabel(cohort.enrolmentClosesAt, zone)
			}, it may be cancelled and every seat refunded in full.`,
		);
	} else if (cohort.enrolmentClosesAt) {
		parts.push(`Enrolment closes ${instantLabel(cohort.enrolmentClosesAt, zone)}.`);
	}
	return parts.length > 0 ? parts.join(" ") : null;
}
