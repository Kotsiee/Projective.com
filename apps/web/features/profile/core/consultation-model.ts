import type { OpenBand, PublicCallOffer, SlotGrid } from "@projective/types/scheduling";
import {
	bandsForDay,
	customStartRefusal,
	zonedParts,
	zonedTimeToInstant,
} from "@projective/types/scheduling";
import type { CallType, ConferencingProvider } from "@projective/types/scheduling";
import { CONFERENCING_LABEL } from "@projective/types/scheduling";

/**
 * consultation-model — the pure, JSX-free brains of the consultation booking modal: the custom
 * start-time arithmetic (a wall-clock minute in the viewer's zone ⇄ an absolute instant), the bounds
 * the time control is allowed to offer, the computed end, and the platform vocabulary.
 *
 * Every function takes the instant or the grid it needs and touches no clock, so SSR and the island
 * agree and a test can pin a DST-transition day without waiting for one.
 */

// #region Time of day
/** The viewer-local minute of the day an instant falls on, in the grid's viewer zone. */
export function minuteOfDay(instant: number, timezone: string): number {
	const p = zonedParts(instant, timezone);
	return p.hour * 60 + p.minute;
}

/**
 * The instant a wall-clock minute of a rail day falls at — the inverse of {@link minuteOfDay},
 * resolved on the CALENDAR so a start typed on a DST-transition day lands on the minute the viewer's
 * clock actually shows.
 */
export function instantOf(dayStart: number, minutes: number, timezone: string): number {
	return zonedTimeToInstant(dayStart, minutes, timezone);
}

/**
 * The minute bounds the custom-start control may offer on a day: from the first open band's start
 * to the last band's end LESS the call's duration, so every offered minute is one the call could at
 * least fit inside. `null` when the day has no open band — the control then withdraws rather than
 * offering a range it cannot check.
 */
export function customStartBounds(
	grid: SlotGrid,
	dayKey: string,
): { min: number; max: number } | null {
	const bands = bandsForDay(grid, dayKey);
	if (bands.length === 0) return null;
	const first = bands[0];
	const last = bands[bands.length - 1];
	const min = minuteOfDay(first.startsAt, grid.viewerTimezone);
	// A band is split at the viewer's midnight when it is built, so an end that reads as minute 0 can
	// only be the NEXT midnight — the end of this day, not its start.
	const endMinute = minuteOfDay(last.endsAt, grid.viewerTimezone);
	const lastEndMinute = endMinute === 0 ? 24 * 60 : endMinute;
	const max = lastEndMinute - grid.durationMinutes;
	if (max < min) return null;
	return { min, max: Math.min(max, 24 * 60 - 1) };
}

/** The instant a chosen custom start ends at — the flavour's duration after it, never chosen. */
export function customEnd(startsAt: number, grid: Pick<SlotGrid, "durationMinutes">): number {
	return startsAt + grid.durationMinutes * 60_000;
}

/**
 * The refusal for a custom start on a day, in the words the modal shows beside the control —
 * the SAME vocabulary the write answers with, so the sentence a buyer reads before sending is the
 * sentence they would read after.
 */
export function customStartProblem(
	grid: SlotGrid,
	dayKey: string,
	startsAt: number,
): string | null {
	const reason = customStartRefusal(grid, dayKey, startsAt);
	if (!reason) return null;
	switch (reason) {
		case "outside_call_window":
			return "Outside the hours this provider takes calls.";
		case "taken":
			return "That overlaps a time somebody has already booked.";
		case "inside_minimum_notice":
			return "Too soon — this provider needs more notice.";
		case "beyond_booking_horizon":
			return "Further ahead than this provider's calendar is open.";
		case "blackout":
			return "The provider is away then.";
		default:
			return "That time is not available.";
	}
}

/** The open bands of a day as the viewer reads them — for the "Available 9:00 AM – 12:30 PM" line. */
export function bandsLabel(bands: readonly OpenBand[], timezone: string, locale?: string): string {
	const fmt = (ms: number) => {
		try {
			return new Intl.DateTimeFormat(locale, {
				timeZone: timezone,
				hour: "numeric",
				minute: "2-digit",
			})
				.format(new Date(ms));
		} catch {
			return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(
				new Date(ms),
			);
		}
	};
	return bands.map((b) => `${fmt(b.startsAt)} – ${fmt(b.endsAt)}`).join(", ");
}
// #endregion

// #region Flavour + platform
/** The length of a call of the given flavour, from the provider's own settings. */
export function callDuration(offer: PublicCallOffer, callType: CallType): number {
	return callType === "paid" ? offer.paidDurationMinutes : offer.courtesyDurationMinutes;
}

/**
 * The flavour a fresh modal opens on: the free intro when there is one, the paid consult otherwise.
 * A provider offering both is asked; one offering one flavour is not — a choice with one option is a
 * fact, not a control.
 */
export function defaultCallType(offer: PublicCallOffer): CallType {
	return offer.courtesyEnabled ? "courtesy" : "paid";
}

/** The platform choices as `{ value, label }` rows, in the provider's own order. */
export function platformOptions(
	platforms: readonly ConferencingProvider[],
): Array<{ value: ConferencingProvider; label: string }> {
	return platforms.map((value) => ({ value, label: CONFERENCING_LABEL[value] }));
}

/**
 * The platform a fresh modal starts on: the provider's first (their preferred) when there is exactly
 * one — implied, and the control is then a statement rather than a choice — else `null` until the
 * buyer picks. With none the host arranges the room, and the control is absent.
 */
export function defaultPlatform(
	platforms: readonly ConferencingProvider[],
): ConferencingProvider | null {
	return platforms.length === 1 ? platforms[0] : null;
}
// #endregion
