import type { DateFormat } from "./preferences.ts";

/**
 * date-format — how a person's dates are written (Settings → Language & region). The preference is
 * `org.user_preferences.date_format`: `null` follows the locale's own numeric order, a value is an
 * explicit override that survives a language change. Pure and isomorphic, so the server render and
 * the client format a date identically.
 */

// #region Labels
/** The pattern each explicit order is written in. */
export const DATE_FORMAT_PATTERN: Readonly<Record<DateFormat, string>> = {
	dmy: "DD/MM/YYYY",
	mdy: "MM/DD/YYYY",
	ymd: "YYYY-MM-DD",
};
// #endregion

// #region Rule
interface DateParts {
	day: string;
	month: string;
	year: string;
}

function partsOf(date: Date, timeZone: string | undefined): DateParts {
	const parts = new Intl.DateTimeFormat("en-GB", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		timeZone,
	}).formatToParts(date);
	const pick = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((part) => part.type === type)?.value ?? "";
	return { day: pick("day"), month: pick("month"), year: pick("year") };
}

/**
 * The numeric order a locale writes dates in, read from `Intl` itself so it is never a hand-kept
 * table: `en-GB` → `dmy`, `en-US` → `mdy`, `ja-JP` → `ymd`. An unknown locale reads as `dmy`.
 */
export function localeDateOrder(locale: string): DateFormat {
	try {
		const order = new Intl.DateTimeFormat(locale, {
			day: "2-digit",
			month: "2-digit",
			year: "numeric",
			timeZone: "UTC",
		})
			.formatToParts(new Date(Date.UTC(2026, 9, 28)))
			.map((part) => part.type)
			.filter((type) => type === "day" || type === "month" || type === "year");
		if (order[0] === "year") return "ymd";
		if (order[0] === "month") return "mdy";
		return "dmy";
	} catch {
		return "dmy";
	}
}

/** The order dates are actually written in: the explicit choice, else the locale's own. */
export function effectiveDateFormat(dateFormat: DateFormat | null, locale: string): DateFormat {
	return dateFormat ?? localeDateOrder(locale);
}

/**
 * Write a date the way this person reads dates. With no explicit order it is the locale's own short
 * numeric form (`08/10/2026`, `10/8/2026`, `2026/10/08`, separators and all); an explicit order is
 * always written zero-padded in its pattern.
 */
export function formatDateValue(
	date: Date,
	options: { locale: string; dateFormat: DateFormat | null; timeZone?: string },
): string {
	if (Number.isNaN(date.getTime())) return "";
	if (options.dateFormat === null) {
		try {
			return new Intl.DateTimeFormat(options.locale, {
				day: "2-digit",
				month: "2-digit",
				year: "numeric",
				timeZone: options.timeZone,
			}).format(date);
		} catch {
			return formatDateValue(date, { ...options, dateFormat: "dmy" });
		}
	}
	const { day, month, year } = partsOf(date, options.timeZone);
	switch (options.dateFormat) {
		case "mdy":
			return `${month}/${day}/${year}`;
		case "ymd":
			return `${year}-${month}-${day}`;
		default:
			return `${day}/${month}/${year}`;
	}
}
// #endregion
