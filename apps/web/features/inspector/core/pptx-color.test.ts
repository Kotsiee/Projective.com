import { assert, assertEquals } from "@std/assert";
import { transformColor } from "./pptx-color.ts";

/** Office rounds through its own float path, so a channel may land one step away. */
function assertNear(actual: string, expected: string): void {
	const parts = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
	const [a, b] = [parts(actual), parts(expected)];
	assert(a.every((value, i) => Math.abs(value - b[i]) <= 1), `${actual} is not ${expected}`);
}

Deno.test("a colour with no transforms comes back as itself", () => {
	assertEquals(transformColor("4472C4", []), "#4472c4");
	assertEquals(transformColor("#FFFFFF", []), "#ffffff");
});

Deno.test("Office's 'lighter 60%' and 'darker 25%' land where PowerPoint puts them", () => {
	const lighter = transformColor("4472C4", [
		{ name: "lumMod", value: 40_000 },
		{ name: "lumOff", value: 60_000 },
	]);
	assertNear(lighter, "#b4c7e7");
	assertNear(transformColor("4472C4", [{ name: "lumMod", value: 75_000 }]), "#2f5597");
});

Deno.test("tint moves toward white, shade toward black", () => {
	assertEquals(transformColor("000000", [{ name: "tint", value: 50_000 }]), "#808080");
	assertEquals(transformColor("ffffff", [{ name: "shade", value: 50_000 }]), "#808080");
});

Deno.test("alpha turns the answer into an rgba colour, without touching the hue", () => {
	assertEquals(
		transformColor("ff0000", [{ name: "alpha", value: 25_000 }]),
		"rgba(255, 0, 0, 0.25)",
	);
});

Deno.test("greys survive the HSL round trip", () => {
	assertEquals(transformColor("7f7f7f", [{ name: "lumMod", value: 100_000 }]), "#7f7f7f");
});

Deno.test("an unknown transform is skipped rather than guessed at", () => {
	assertEquals(transformColor("123456", [{ name: "gamma", value: 50_000 }]), "#123456");
});
