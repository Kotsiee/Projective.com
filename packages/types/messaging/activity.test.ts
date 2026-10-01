import { assert, assertEquals } from "@std/assert";
import { compactActivityLabel } from "./activity.ts";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

Deno.test("each unit takes over at its boundary", () => {
	assertEquals(compactActivityLabel(ago(30_000), NOW), "now");
	assertEquals(compactActivityLabel(ago(MIN), NOW), "1m");
	assertEquals(compactActivityLabel(ago(59 * MIN), NOW), "59m");
	assertEquals(compactActivityLabel(ago(60 * MIN), NOW), "1h");
	assertEquals(compactActivityLabel(ago(23 * 60 * MIN), NOW), "23h");
	assertEquals(compactActivityLabel(ago(24 * 60 * MIN), NOW), "1d");
	assertEquals(compactActivityLabel(ago(6 * 24 * 60 * MIN), NOW), "6d");
	assertEquals(compactActivityLabel(ago(7 * 24 * 60 * MIN), NOW), "1w");
	assertEquals(compactActivityLabel(ago(364 * 24 * 60 * MIN), NOW), "52w");
	assertEquals(compactActivityLabel(ago(800 * 24 * 60 * MIN), NOW), "2y");
});

Deno.test("never more than three characters, so the 48px slot always holds it", () => {
	for (let days = 0; days < 4000; days += 7) {
		const label = compactActivityLabel(ago(days * 24 * 60 * MIN + 13 * MIN), NOW);
		assert(label.length <= 3, `${label} at ${days} days`);
	}
});

Deno.test("a clock skewed into the future reads now; an unparseable instant reads nothing", () => {
	assertEquals(compactActivityLabel(new Date(NOW + 5 * MIN).toISOString(), NOW), "now");
	assertEquals(compactActivityLabel("not a date", NOW), "");
});
