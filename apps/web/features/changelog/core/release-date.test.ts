import { assertEquals } from "@std/assert";
import { formatShortReleaseDate } from "./release-date.ts";

/**
 * The gutter date: a short month, the UTC day whatever the reader's zone, and the input back when
 * it is not a date. Its longest form must stay short enough for the gutter under every overlay.
 */

Deno.test("a release day prints with a short month, in UTC", () => {
	assertEquals(formatShortReleaseDate("2026-10-17"), "17 Oct 2026");
	assertEquals(formatShortReleaseDate("2026-07-15T23:30:00Z"), "15 Jul 2026");
	assertEquals(formatShortReleaseDate("2026-01-01"), "1 Jan 2026");
});

Deno.test("the longest gutter date stays within twelve characters", () => {
	for (let month = 1; month <= 12; month++) {
		const iso = `2026-${String(month).padStart(2, "0")}-28`;
		const printed = formatShortReleaseDate(iso);
		assertEquals(printed.length <= 12, true, printed);
	}
});

Deno.test("an unparseable day is returned as written", () => {
	assertEquals(formatShortReleaseDate("soon"), "soon");
});
