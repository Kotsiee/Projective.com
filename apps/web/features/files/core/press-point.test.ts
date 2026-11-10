import { assertEquals } from "@std/assert";
import { freshPress, PRESS_WINDOW_MS } from "./press-point.ts";

Deno.test("press: a recent press is where the form opens; a stale or missing one is not", () => {
	const press = { x: 120, y: 340, at: 1000 };
	assertEquals(freshPress(press, 1200), { x: 120, y: 340 });
	assertEquals(freshPress(press, 1000 + PRESS_WINDOW_MS), { x: 120, y: 340 });
	assertEquals(freshPress(press, 1001 + PRESS_WINDOW_MS), null);
	assertEquals(freshPress(press, 900), null);
	assertEquals(freshPress(null, 1200), null);
});
