import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
	dragRotation,
	keyRotation,
	RULER_PX_PER_DEGREE,
	rulerOffset,
	rulerTicks,
	turnAngle,
	wheelRotation,
} from "./rotation-ruler.ts";

Deno.test("rulerOffset: (θ mod 360) × pixelsPerDegree, for negative angles too", () => {
	assertEquals(rulerOffset(0), 0);
	assertEquals(rulerOffset(30, 4), 120);
	assertEquals(rulerOffset(-30, 4), 330 * 4);
	assertEquals(rulerOffset(390, 4), 120);
	assertEquals(turnAngle(Number.NaN), 0);
});

Deno.test("rulerTicks: the needle sits on the current angle's tick", () => {
	const ticks = rulerTicks(37, 120);
	const under = ticks.find((t) => Math.abs(t.x) < 1e-9);
	assert(under, "a tick under the needle");
	assertEquals(under.tier, "minor");
	for (const t of ticks) assert(Math.abs(t.x) <= 120 + 1e-9);
});

Deno.test("rulerTicks: majors every 15° labelled in (-180, 180], mids every 5°", () => {
	const ticks = rulerTicks(0, 200);
	const labels = ticks.filter((t) => t.tier === "major").map((t) => t.label);
	assert(labels.includes("0°"));
	assert(labels.includes("15°"));
	assert(labels.includes("-15°"));
	assertEquals(ticks.filter((t) => t.tier === "mid").length > 0, true);
});

Deno.test("rulerTicks: the strip is seamless across the wrap — 180° sits beside -165°", () => {
	const ticks = rulerTicks(180, 15 * RULER_PX_PER_DEGREE);
	const labels = ticks.filter((t) => t.tier === "major").map((t) => t.label);
	assertEquals(labels, ["165°", "180°", "-165°"]);
	const keys = ticks.map((t) => t.key);
	assertEquals(new Set(keys).size, keys.length);
});

Deno.test("dragRotation: the strip follows the pointer and wraps", () => {
	assertAlmostEquals(dragRotation(0, -RULER_PX_PER_DEGREE * 10), 10);
	assertAlmostEquals(dragRotation(175, -RULER_PX_PER_DEGREE * 10), -175);
	assertAlmostEquals(dragRotation(-175, RULER_PX_PER_DEGREE * 10), 175);
});

Deno.test("wheelRotation: either axis rolls, lines and pages scale up", () => {
	assert(wheelRotation(0, 0, 100) > 0);
	assert(wheelRotation(0, -100, 10) < 0);
	assert(Math.abs(wheelRotation(0, 0, 1, 1)) > Math.abs(wheelRotation(0, 0, 1, 0)));
});

Deno.test("keyRotation: arrows step, Shift and PageUp take 15°, Home resets, others pass", () => {
	assertEquals(keyRotation(0, "ArrowRight", false), 1);
	assertEquals(keyRotation(0, "ArrowLeft", true), -15);
	assertEquals(keyRotation(179, "ArrowRight", false), 180);
	assertEquals(keyRotation(180, "ArrowRight", false), -179);
	assertEquals(keyRotation(40, "PageDown", false), 25);
	assertEquals(keyRotation(40, "Home", false), 0);
	assertEquals(keyRotation(40, "Enter", false), null);
});
