import { assertEquals, assertNotEquals } from "@std/assert";
import { depthAdvanced, placementKey, railDepth } from "./discovery-telemetry.ts";

Deno.test("rail depth is the visible window's far edge over the track width", () => {
	assertEquals(railDepth(0, 400, 1600), 0.25);
	assertEquals(railDepth(1200, 400, 1600), 1);
	assertEquals(railDepth(-600, 400, 1600), 0.63);
});

Deno.test("a track that does not overflow is fully seen", () => {
	assertEquals(railDepth(0, 800, 600), 1);
	assertEquals(railDepth(0, 0, 0), 1);
});

Deno.test("depth is re-sent only when it grows past the step", () => {
	assertEquals(depthAdvanced(0.25, 0), true);
	assertEquals(depthAdvanced(0.255, 0.25), false);
	assertEquals(depthAdvanced(0.3, 0.25), true);
});

Deno.test("the same item in two rails is two placements", () => {
	assertNotEquals(placementKey("a", "services"), placementKey("a", "recommended"));
	assertEquals(placementKey("a", undefined), placementKey("a", undefined));
});
