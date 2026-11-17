/** A time-zone choice as the editors' `Select` takes it. */
export interface TimeZoneOption {
	label: string;
	value: string;
}

let cached: TimeZoneOption[] | null = null;

/** The time zones offered — the platform's own list, so a saved value is one the database knows. */
export function timeZoneOptions(): TimeZoneOption[] {
	if (cached) return cached;
	let zones: string[];
	try {
		zones = (Intl as unknown as { supportedValuesOf(key: string): string[] }).supportedValuesOf(
			"timeZone",
		);
	} catch {
		zones = ["UTC"];
	}
	cached = zones.map((zone) => ({ label: zone.replace(/_/g, " "), value: zone }));
	return cached;
}
