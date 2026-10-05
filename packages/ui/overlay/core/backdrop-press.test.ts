import { assert, assertFalse } from "@std/assert";
import { isDismissPress, PRESS_SLOP } from "./backdrop-press.ts";

const at = (x: number, y: number) => ({ x, y });

Deno.test("a press that starts and ends on the scrim dismisses", () => {
	assert(isDismissPress(at(10, 10), at(10, 10), true));
	assert(isDismissPress(at(10, 10), at(10 + PRESS_SLOP, 10), true));
});

Deno.test("a press that began inside the dialog never dismisses", () => {
	assertFalse(isDismissPress(null, at(10, 10), true));
});

Deno.test("a click whose target is a descendant of the surface never dismisses", () => {
	assertFalse(isDismissPress(at(10, 10), at(10, 10), false));
});

Deno.test("a drag released back over the scrim never dismisses", () => {
	assertFalse(isDismissPress(at(10, 10), at(10 + PRESS_SLOP + 1, 10), true));
	assertFalse(isDismissPress(at(10, 10), at(200, 300), true));
});
