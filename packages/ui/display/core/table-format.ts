/**
 * Cell formatters for `DataTable`. Pure and locale-parameterised, with the `Intl` instances cached
 * per option set, because a virtualized table formats the same few hundred cells on every scroll.
 */
import type { DateFormat, NumberFormat } from "../types/data-table.ts";

// #region Intl cache
const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
	const key = `${locale}|${JSON.stringify(options)}`;
	let fmt = numberFormats.get(key);
	if (!fmt) {
		fmt = new Intl.NumberFormat(locale, options);
		numberFormats.set(key, fmt);
	}
	return fmt;
}

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	const key = `${locale}|${JSON.stringify(options)}`;
	let fmt = dateFormats.get(key);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat(locale, options);
		dateFormats.set(key, fmt);
	}
	return fmt;
}

function relativeFormat(locale: string): Intl.RelativeTimeFormat {
	let fmt = relativeFormats.get(locale);
	if (!fmt) {
		fmt = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
		relativeFormats.set(locale, fmt);
	}
	return fmt;
}
// #endregion

// #region Numbers
/** Format a number for a `number` column. `digits` caps the fraction digits of `decimal` and `percent`. */
export function formatNumber(
	value: number,
	format: NumberFormat,
	locale: string,
	digits = 1,
): string {
	if (!Number.isFinite(value)) return "";
	switch (format) {
		case "integer":
			return numberFormat(locale, { maximumFractionDigits: 0 }).format(value);
		case "decimal":
			return numberFormat(locale, { maximumFractionDigits: digits }).format(value);
		case "compact":
			return numberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
		case "percent":
			return numberFormat(locale, { style: "percent", maximumFractionDigits: digits }).format(
				value,
			);
	}
}

/** Human byte size in binary steps: `512 B`, `2.4 KB`, `38 MB`, `1.2 GB`. */
export function formatBytes(bytes: number, locale: string): string {
	if (!Number.isFinite(bytes) || bytes < 0) return "";
	if (bytes < 1024) return `${numberFormat(locale, { maximumFractionDigits: 0 }).format(bytes)} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let size = bytes / 1024;
	let unit = 0;
	while (size >= 1024 && unit < units.length - 1) {
		size /= 1024;
		unit++;
	}
	const digits = size < 10 || unit >= 2 ? 1 : 0;
	return `${numberFormat(locale, { maximumFractionDigits: digits }).format(size)} ${units[unit]}`;
}

/** `m:ss`, or `h:mm:ss` from an hour up. */
export function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "";
	const total = Math.round(ms / 1000);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const ss = String(s).padStart(2, "0");
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** `4.8`, the rating average to one decimal. */
export function formatRating(average: number, locale: string): string {
	return numberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
		average,
	);
}
// #endregion

// #region Dates
/** Normalise a cell's instant to epoch ms, or `null` when it is missing or unparseable. */
export function toEpoch(value: string | number | Date | null | undefined): number | null {
	if (value == null || value === "") return null;
	const ms = value instanceof Date
		? value.getTime()
		: typeof value === "number"
		? value
		: Date.parse(value);
	return Number.isFinite(ms) ? ms : null;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** `5 min. ago`, `yesterday`, `in 3 days` — the largest unit that keeps the figure at least 1. */
export function formatRelative(ms: number, now: number, locale: string): string {
	const diff = ms - now;
	const abs = Math.abs(diff);
	const fmt = relativeFormat(locale);
	if (abs < MINUTE) return fmt.format(0, "second");
	if (abs < HOUR) return fmt.format(Math.round(diff / MINUTE), "minute");
	if (abs < DAY) return fmt.format(Math.round(diff / HOUR), "hour");
	if (abs < WEEK) return fmt.format(Math.round(diff / DAY), "day");
	if (abs < MONTH) return fmt.format(Math.round(diff / WEEK), "week");
	if (abs < YEAR) return fmt.format(Math.round(diff / MONTH), "month");
	return fmt.format(Math.round(diff / YEAR), "year");
}

/**
 * Format an instant for a `date` column. Absolute formats drop the year inside the current year,
 * and `datetime` joins the date and time with a middot (`14 Jul · 14:30`).
 */
export function formatDate(
	ms: number,
	format: DateFormat,
	locale: string,
	now: number,
	timeZone?: string,
): string {
	if (format === "relative") return formatRelative(ms, now, locale);
	const sameYear = new Date(ms).getUTCFullYear() === new Date(now).getUTCFullYear();
	const day: Intl.DateTimeFormatOptions = {
		day: "numeric",
		month: "short",
		...(sameYear ? {} : { year: "numeric" }),
		timeZone,
	};
	const time: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", timeZone };
	if (format === "date") return dateFormat(locale, day).format(ms);
	if (format === "time") return dateFormat(locale, time).format(ms);
	return `${dateFormat(locale, day).format(ms)} · ${dateFormat(locale, time).format(ms)}`;
}

/** The full, unambiguous instant for a cell's `title` and accessible description. */
export function formatDateFull(ms: number, locale: string, timeZone?: string): string {
	return dateFormat(locale, { dateStyle: "full", timeStyle: "short", timeZone }).format(ms);
}
// #endregion
