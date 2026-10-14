import { assertEquals } from "@std/assert";
import { stepperKey } from "./number-stepper.ts";
import { durationLabel, durationSegment } from "./duration.ts";

const bounds = { min: 5, max: 600, step: 5, bigStep: 30 };

Deno.test("arrow keys step, Page keys big-step, Home/End go to the bounds", () => {
	assertEquals(stepperKey(30, "ArrowUp", bounds), 35);
	assertEquals(stepperKey(30, "ArrowDown", bounds), 25);
	assertEquals(stepperKey(30, "PageUp", bounds), 60);
	assertEquals(stepperKey(30, "PageDown", bounds), 5);
	assertEquals(stepperKey(30, "Home", bounds), 5);
	assertEquals(stepperKey(30, "End", bounds), 600);
	assertEquals(stepperKey(30, "ArrowLeft", bounds), undefined);
});

Deno.test("steps clamp at the bounds and snap onto the grid", () => {
	assertEquals(stepperKey(600, "ArrowUp", bounds), 600);
	assertEquals(stepperKey(5, "PageDown", bounds), 5);
	assertEquals(stepperKey(32, "ArrowUp", bounds), 35);
	assertEquals(stepperKey(null, "ArrowUp", bounds), 10);
	assertEquals(stepperKey(3, "Home", {}), undefined);
	assertEquals(stepperKey(3, "PageUp", {}), 13);
});

Deno.test("a duration selects its preset, anything else is custom", () => {
	assertEquals(durationSegment(45), "45");
	assertEquals(durationSegment(75), "custom");
	assertEquals(durationSegment(null), "custom");
	assertEquals(durationLabel(45), "45 min");
	assertEquals(durationLabel(60), "1 h");
	assertEquals(durationLabel(90), "1 h 30 min");
});
