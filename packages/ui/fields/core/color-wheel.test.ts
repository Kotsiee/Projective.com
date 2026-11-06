import { assertAlmostEquals, assertEquals } from "@std/assert";
import { hueSaturationToWheel, wheelToHueSaturation } from "./color-wheel.ts";

Deno.test("red sits at the top, and the hue runs clockwise", () => {
	assertEquals(wheelToHueSaturation(0, -100, 100), { h: 0, s: 100 });
	assertEquals(wheelToHueSaturation(100, 0, 100), { h: 90, s: 100 });
	assertEquals(wheelToHueSaturation(0, 100, 100), { h: 180, s: 100 });
	assertEquals(wheelToHueSaturation(-100, 0, 100), { h: 270, s: 100 });
});

Deno.test("saturation is the distance from the centre, and stops at the rim", () => {
	assertEquals(wheelToHueSaturation(0, -50, 100).s, 50);
	assertEquals(wheelToHueSaturation(0, -400, 100).s, 100);
	assertEquals(wheelToHueSaturation(0, 0, 100), { h: 0, s: 0 });
});

Deno.test("a colour round-trips through the wheel", () => {
	for (const [h, s] of [[0, 100], [47, 62], [133, 20], [211, 88], [359, 100]]) {
		const point = hueSaturationToWheel(h, s);
		const back = wheelToHueSaturation(point.x - 50, point.y - 50, 50);
		assertEquals(back.s, s);
		assertAlmostEquals(back.h, h, 1);
	}
});

Deno.test("no saturation is the middle of the wheel, whatever the hue", () => {
	assertEquals(hueSaturationToWheel(211, 0), { x: 50, y: 50 });
});
