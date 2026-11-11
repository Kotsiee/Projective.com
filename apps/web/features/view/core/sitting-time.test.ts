import { assertEquals } from "@std/assert";
import { sittingLabel } from "./sitting-time.ts";

const START = "2026-11-17T18:00:00.000Z";
const END = "2026-11-17T19:30:00.000Z";

Deno.test("without a viewer zone the label is UTC and says so", () => {
	assertEquals(sittingLabel(START, END, null, "en-GB"), "Tue 17 Nov · 18:00–19:30 UTC");
});

Deno.test("with the viewer's zone the label is local and carries no suffix", () => {
	assertEquals(sittingLabel(START, END, "Asia/Tokyo", "en-GB"), "Wed 18 Nov · 03:00–04:30");
});

Deno.test("an unknown zone falls back to labelled UTC, and a bad instant prints nothing", () => {
	assertEquals(sittingLabel(START, END, "Mars/Olympus", "en-GB"), "Tue 17 Nov · 18:00–19:30 UTC");
	assertEquals(sittingLabel("not a date", END, null, "en-GB"), "");
});
