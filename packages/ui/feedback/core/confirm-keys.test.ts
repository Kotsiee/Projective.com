import { assertEquals } from "@std/assert";
import { confirmActionTarget } from "./confirm-keys.ts";

Deno.test("confirmActionTarget: ← and → step between the pair and wrap", () => {
	assertEquals(confirmActionTarget("ArrowRight", 0, 2), 1);
	assertEquals(confirmActionTarget("ArrowRight", 1, 2), 0);
	assertEquals(confirmActionTarget("ArrowLeft", 0, 2), 1);
	assertEquals(confirmActionTarget("ArrowLeft", 1, 2), 0);
	assertEquals(confirmActionTarget("ArrowRight", 2, 3), 0);
});

Deno.test("confirmActionTarget: right-to-left mirrors the arrows", () => {
	assertEquals(confirmActionTarget("ArrowLeft", 0, 3, true), 1);
	assertEquals(confirmActionTarget("ArrowRight", 0, 3, true), 2);
});

Deno.test("confirmActionTarget: Home and End jump to the ends", () => {
	assertEquals(confirmActionTarget("Home", 1, 2), 0);
	assertEquals(confirmActionTarget("End", 0, 2), 1);
});

Deno.test("confirmActionTarget: other keys, one action or focus outside the pair move nothing", () => {
	assertEquals(confirmActionTarget("Enter", 0, 2), null);
	assertEquals(confirmActionTarget("ArrowDown", 0, 2), null);
	assertEquals(confirmActionTarget("ArrowRight", 0, 1), null);
	assertEquals(confirmActionTarget("ArrowRight", -1, 2), null);
});
