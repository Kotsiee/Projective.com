import { fmtMinutes } from "./civil.ts";
import type { Band, Layer, RuleDraft } from "./types.ts";

// #region Names
const SUNDAY_UTC = Date.UTC(2023, 0, 1);

/** A weekday's name (0 = Sunday) in `locale`. */
export function weekdayName(
	day: number,
	locale = "en-GB",
	width: "long" | "short" = "long",
): string {
	return new Intl.DateTimeFormat(locale, { weekday: width, timeZone: "UTC" })
		.format(SUNDAY_UTC + day * 86_400_000);
}

/** A month's name for a `YYYY-MM` key. */
export function monthName(month: string, locale = "en-GB"): string {
	const [y, m] = month.split("-").map(Number);
	return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" })
		.format(Date.UTC(y, m - 1, 1));
}

/** A date's long name ("Wednesday 14 October"). */
export function dateName(iso: string, locale = "en-GB"): string {
	const [y, m, d] = iso.split("-").map(Number);
	return new Intl.DateTimeFormat(locale, {
		weekday: "long",
		day: "numeric",
		month: "long",
		timeZone: "UTC",
	}).format(Date.UTC(y, m - 1, d));
}

/** The layer as a phrase. */
export function layerName(layer: Layer): string {
	return layer === "working_hours" ? "working hours" : "call window";
}

/** A band as "06:00 to 12:00". */
export function bandRange(band: Band): string {
	return `${fmtMinutes(band.start)} to ${fmtMinutes(band.end)}`;
}

/** The name a rule goes by: its label, else the recurrence segment of its sentence. */
export function ruleName(rule: RuleDraft, describe: (rule: RuleDraft) => string): string {
	return rule.label.trim() || describe(rule).split(" · ")[0];
}

/** A band button's accessible name (plan §5.4). */
export function bandLabel(
	day: number,
	band: Band,
	layer: Layer,
	rule: string,
	locale?: string,
): string {
	return `${weekdayName(day, locale)}, ${bandRange(band)}, ${layerName(layer)}, rule: ${rule}`;
}
// #endregion

// #region Announcements
/** The live-region sentence after a band is created. */
export function announceCreated(day: number, band: Band, layer: Layer, locale?: string): string {
	return `Created ${weekdayName(day, locale)}, ${bandRange(band)}, ${layerName(layer)}.`;
}

/** The live-region sentence after an overnight drag is stored as two bands. */
export function announceOvernight(
	day: number,
	start: number,
	nextDay: number,
	end: number,
	layer: Layer,
	locale?: string,
): string {
	return `Created ${weekdayName(day, locale)} ${fmtMinutes(start)} to ${
		weekdayName(nextDay, locale)
	} ${fmtMinutes(end)}, ${layerName(layer)}, stored as two bands.`;
}

/** The live-region sentence after a band moves. */
export function announceMoved(day: number, band: Band, locale?: string): string {
	return `Moved to ${weekdayName(day, locale)}, ${bandRange(band)}.`;
}

/** The live-region sentence after a band is resized. */
export function announceResized(day: number, band: Band, locale?: string): string {
	return `Resized to ${weekdayName(day, locale)}, ${bandRange(band)}.`;
}

/** The live-region sentence after a band is duplicated. */
export function announceDuplicated(day: number, band: Band, locale?: string): string {
	return `Duplicated to ${weekdayName(day, locale)}, ${bandRange(band)}.`;
}

/** The live-region sentence after a band is deleted. */
export function announceDeleted(
	day: number,
	band: Band,
	layer: Layer,
	ruleRemoved: boolean,
	locale?: string,
): string {
	const base = `Deleted ${weekdayName(day, locale)}, ${bandRange(band)}, ${layerName(layer)}.`;
	return ruleRemoved ? `${base} Its rule was removed; undo to restore it.` : base;
}
// #endregion
