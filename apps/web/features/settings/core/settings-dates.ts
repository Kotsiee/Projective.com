/** A date the person reads in full (`7 November 2026`), in their own locale. */
export function longDate(iso: string, locale: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	try {
		return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(date);
	} catch {
		return date.toISOString().slice(0, 10);
	}
}
