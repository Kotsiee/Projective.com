/**
 * A sitting's day and time window as a listing page prints it ("Tue 12 Nov · 18:00–19:30").
 *
 * With no viewer zone — the first byte, before the browser has said where the reader is — it formats
 * in UTC and says so, rather than printing a zone the reader may not live in. A zone the runtime does
 * not know falls back the same way. An unparseable instant yields an empty string.
 */
export function sittingLabel(
	startsAt: string,
	endsAt: string,
	zone: string | null,
	locale?: string,
): string {
	const start = new Date(startsAt);
	const end = new Date(endsAt);
	if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
	if (zone !== null && !isKnownZone(zone)) return sittingLabel(startsAt, endsAt, null, locale);
	const timeZone = zone ?? "UTC";
	const day = new Intl.DateTimeFormat(locale, {
		timeZone,
		weekday: "short",
		day: "numeric",
		month: "short",
	})
		.format(start);
	const clock = new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" });
	return `${day} · ${clock.format(start)}–${clock.format(end)}${zone === null ? " UTC" : ""}`;
}

/** The browser's own IANA zone, or `null` where the runtime reports none. */
export function browserZone(): string | null {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
}

function isKnownZone(zone: string): boolean {
	try {
		new Intl.DateTimeFormat(undefined, { timeZone: zone });
		return true;
	} catch (err) {
		if (err instanceof RangeError) return false;
		throw err;
	}
}
