import { assertEquals } from "@std/assert";
import { enterOutcome, type EnterStep } from "./details-keys.ts";

const text = (filled = true): EnterStep => ({ picker: false, open: false, filled, required: true });
const picker = (over: Partial<EnterStep> = {}): EnterStep => ({
	picker: true,
	open: false,
	filled: true,
	required: true,
	...over,
});

Deno.test("Enter on a text field moves to the next control, filled or not", () => {
	assertEquals(enterOutcome([text(), text()], 0), { kind: "focus", index: 1 });
	assertEquals(enterOutcome([text(false), text()], 0), { kind: "focus", index: 1 });
});

Deno.test("Enter on the last control submits", () => {
	assertEquals(enterOutcome([text(), text()], 1), { kind: "submit" });
	assertEquals(enterOutcome([text(), picker()], 1), { kind: "submit" });
});

Deno.test("a filled picker is stepped over; an open one keeps Enter for its list", () => {
	assertEquals(enterOutcome([picker(), text()], 0), { kind: "focus", index: 1 });
	assertEquals(enterOutcome([picker({ open: true }), text()], 0), { kind: "native" });
});

Deno.test("an empty required picker opens; an empty optional one is stepped over", () => {
	assertEquals(enterOutcome([picker({ filled: false }), text()], 0), { kind: "native" });
	assertEquals(
		enterOutcome([picker({ filled: false, required: false }), text()], 0),
		{ kind: "focus", index: 1 },
	);
});

Deno.test("a control outside the walk is left alone", () => {
	assertEquals(enterOutcome([text()], -1), { kind: "native" });
	assertEquals(enterOutcome([], 0), { kind: "native" });
});
