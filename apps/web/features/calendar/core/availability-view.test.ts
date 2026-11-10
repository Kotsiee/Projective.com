import { assertEquals } from "@std/assert";
import { calendarModeHref, calendarModeOf, presetSlugOf } from "./availability-view.ts";

const at = (path: string) => new URL(path, "https://projective.test");

Deno.test("only ?view=availability leaves the agenda", () => {
	assertEquals(calendarModeOf(at("/calendar")), "agenda");
	assertEquals(calendarModeOf(at("/calendar?view=events")), "agenda");
	assertEquals(calendarModeOf(at("/calendar?view=availability")), "availability");
	assertEquals(calendarModeOf(at("/calendar?view=Availability")), "agenda");
	assertEquals(calendarModeOf(at("/calendar?view=month")), "agenda");
});

Deno.test("a preset slug is read only when it is shaped like one", () => {
	assertEquals(
		presetSlugOf(at("/calendar?view=availability&preset=avp-eysnqbcxpo")),
		"avp-eysnqbcxpo",
	);
	assertEquals(presetSlugOf(at("/calendar?preset=4f6d0c3e-0000-4000-8000-000000000001")), null);
	assertEquals(presetSlugOf(at("/calendar?preset=avp-<script>")), null);
});

Deno.test("the mode links round-trip through the reader", () => {
	assertEquals(calendarModeHref("agenda"), "/calendar");
	const href = calendarModeHref("availability", "avp-eysnqbcxpo");
	assertEquals(href, "/calendar?view=availability&preset=avp-eysnqbcxpo");
	assertEquals(calendarModeOf(at(href)), "availability");
	assertEquals(presetSlugOf(at(href)), "avp-eysnqbcxpo");
});
