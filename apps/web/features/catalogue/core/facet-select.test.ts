import { assertEquals } from "@std/assert";
import { facetClickOf, pickFacet } from "./facet-select.ts";

const ORDER = ["published", "draft", "paused", "archived"] as const;
type S = typeof ORDER[number];
const DEFAULTS: S[] = ["published", "draft", "paused"];

Deno.test("modifiers map to the explorer's four presses", () => {
	const keys = (ctrlKey: boolean, metaKey: boolean, shiftKey: boolean) =>
		facetClickOf({ ctrlKey, metaKey, shiftKey });
	assertEquals(keys(false, false, false), "only");
	assertEquals(keys(true, false, false), "toggle");
	assertEquals(keys(false, true, false), "toggle");
	assertEquals(keys(false, false, true), "range");
	assertEquals(keys(true, false, true), "add-range");
});

Deno.test("a plain press selects only that value, and again returns to the fallback", () => {
	const once = pickFacet(ORDER, DEFAULTS, "draft", "only", null, DEFAULTS);
	assertEquals(once, { selected: ["draft"], anchor: "draft" });
	const twice = pickFacet(ORDER, once.selected, "draft", "only", once.anchor, DEFAULTS);
	assertEquals(twice, { selected: DEFAULTS, anchor: null });
});

Deno.test("Ctrl/Cmd toggles one value and keeps the order of the rows", () => {
	const added = pickFacet(ORDER, DEFAULTS, "archived", "toggle", null, DEFAULTS);
	assertEquals(added.selected, ["published", "draft", "paused", "archived"]);
	const removed = pickFacet(ORDER, added.selected, "draft", "toggle", "archived", DEFAULTS);
	assertEquals(removed, { selected: ["published", "paused", "archived"], anchor: "draft" });
});

Deno.test("Shift selects the run from the anchor, either direction, and keeps the anchor", () => {
	assertEquals(
		pickFacet(ORDER, ["draft"], "archived", "range", "draft", DEFAULTS),
		{ selected: ["draft", "paused", "archived"], anchor: "draft" },
	);
	assertEquals(
		pickFacet(ORDER, ["paused"], "published", "range", "paused", DEFAULTS),
		{ selected: ["published", "draft", "paused"], anchor: "paused" },
	);
});

Deno.test("Ctrl/Cmd+Shift adds the run to what is selected", () => {
	assertEquals(
		pickFacet(ORDER, ["published"], "archived", "add-range", "paused", DEFAULTS),
		{ selected: ["published", "paused", "archived"], anchor: "paused" },
	);
});

Deno.test("a range with no anchor falls back to a plain press", () => {
	assertEquals(
		pickFacet(ORDER, DEFAULTS, "archived", "range", null, DEFAULTS),
		{ selected: ["archived"], anchor: "archived" },
	);
});

Deno.test("an unfiltered facet's fallback is empty", () => {
	const models = ["Pipeline", "Session"] as const;
	assertEquals(pickFacet(models, ["Session"], "Session", "only", "Session", []), {
		selected: [],
		anchor: null,
	});
});
