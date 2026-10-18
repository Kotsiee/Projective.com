/**
 * release-date.ts — how the changelog prints a release day where room is short (P5, Decision #278).
 *
 * The timeline's gutter holds the date in the mono face beside each entry; a long month
 * ("23 September 2026", 17 characters) does not fit it under the dyslexic overlay's wider tracking
 * and face, so the gutter prints the short month ("23 Sept 2026") and the `<time datetime>` keeps
 * the exact day. Headers and the release page keep the full date (`formatContentDate`).
 */

// #region Format
/**
 * A release day (`YYYY-MM-DD`, or a date-time whose first ten characters are one) with a short
 * month, in UTC so the day never shifts with the reader's zone: `23 Sept 2026` in `en-GB`. An
 * unparseable input is returned as written.
 */
export function formatShortReleaseDate(isoDate: string, locale = "en-GB"): string {
	const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
	if (Number.isNaN(date.getTime())) return isoDate;
	return new Intl.DateTimeFormat(locale, {
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	}).format(date);
}
// #endregion
