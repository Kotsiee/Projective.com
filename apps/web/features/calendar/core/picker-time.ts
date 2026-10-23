import { calendarTime } from "@projective/ui/calendar";

/**
 * picker-time — the one bridge between a `DateTimePicker`'s device-local `Date` and an instant in the
 * SCHEDULE's zone, shared by every calendar control that edits a time: the event modal's start and
 * end, and the export modal's custom range.
 *
 * The picker reasons in the DEVICE's wall-clock fields; every instant on this surface is rendered in
 * the SCHEDULE's zone. An instant is handed to the control as a device-local `Date` whose
 * year/month/day/hour/minute ARE the schedule zone's, and read back through
 * {@link calendarTime.zonedTimeToMs}, which resolves those same fields in `tz` with the DST
 * correction. Without the bridge a host in Lisbon editing a Tokyo schedule would read 09:00 on the
 * bar, open the picker on 01:00, and move the session by eight hours without ever being shown the
 * number they actually changed.
 *
 * Seconds are dropped on purpose: the picker is minute-granular, so carrying a second through a field
 * that cannot express it only lets the value drift back on the next read.
 *
 * One residual case this cannot fix: when the schedule's wall time falls inside the DEVICE zone's own
 * spring-forward gap, the `Date` constructor normalises to the next real local instant and the trigger
 * prints an hour the bar does not. It is reachable for one hour a year, and the honest fix is a
 * zone-aware picker rather than a correction here that would be wrong for the other 8759.
 */

/** An instant as the device-local `Date` whose wall-clock fields are `tz`'s. */
export function toPickerDate(ms: number, tz: string): Date {
	const p = calendarTime.zonedParts(ms, tz);
	return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
}

/** The inverse of {@link toPickerDate} — the picker's wall-clock fields, resolved in `tz`. */
export function fromPickerDate(d: Date, tz: string): number {
	return calendarTime.zonedTimeToMs(
		d.getFullYear(),
		d.getMonth() + 1,
		d.getDate(),
		d.getHours(),
		d.getMinutes(),
		tz,
	);
}
