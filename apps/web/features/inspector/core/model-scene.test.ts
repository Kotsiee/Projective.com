import { assert, assertEquals } from "@std/assert";
import {
	aggregateStats,
	boundsCenter,
	boundsRadius,
	boundsSize,
	decodeDataUrl,
	formatClipTime,
	formatCount,
	formatDimensions,
	formatLength,
	gridStep,
	itemLabel,
	missingGeometryReason,
	missingNotice,
	modelFacts,
	modelUnit,
	objMaterialLibraries,
	resourceName,
	triangleCount,
	usableBounds,
} from "./model-scene.ts";

Deno.test("bounds helpers measure a box", () => {
	const b = { min: [-1, 0, -2] as const, max: [1, 2, 2] as const };
	assertEquals(boundsSize(b), [2, 2, 4]);
	assertEquals(boundsCenter(b), [0, 1, 0]);
	assertEquals(boundsRadius(b), Math.hypot(2, 2, 4) / 2);
	assert(usableBounds(b));
	assert(
		!usableBounds({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }),
	);
	assert(!usableBounds({ min: [0, 0, 0], max: [0, 0, 0] }));
});

Deno.test("gridStep picks 1-2-5 steps", () => {
	assertEquals(gridStep(10), 1);
	assertEquals(gridStep(25), 2);
	assertEquals(gridStep(0.4), 0.05);
	assertEquals(gridStep(0), 1);
});

Deno.test("triangleCount uses the index, vertex count and instances", () => {
	assertEquals(triangleCount(36, 24), 12);
	assertEquals(triangleCount(null, 9), 3);
	assertEquals(triangleCount(6, 4, 10), 20);
});

Deno.test("aggregateStats counts shared materials and textures once", () => {
	const stats = aggregateStats(
		[
			{ vertices: 24, triangles: 12, materials: ["m1"], textures: ["t1", "t2"] },
			{ vertices: 8, triangles: 4, materials: ["m1", "m2"], textures: ["t2"] },
		],
		{ animations: 2, cameras: 1, lights: 0 },
	);
	assertEquals(stats, {
		meshes: 2,
		vertices: 32,
		triangles: 16,
		materials: 2,
		textures: 2,
		animations: 2,
		cameras: 1,
		lights: 0,
	});
});

Deno.test("formatting helpers", () => {
	assertEquals(formatCount(1234567), "1,234,567");
	assertEquals(formatLength(1.23456), "1.23");
	assertEquals(formatLength(0.000456789), "0.000457");
	assertEquals(formatLength(1234.5), "1,235");
	assertEquals(formatLength(2), "2");
	assertEquals(formatDimensions([1.5, 0.25, 2], "m"), "1.5 × 0.25 × 2 m");
	assertEquals(formatDimensions([1, 1, 1], null), "1 × 1 × 1 units");
	assertEquals(formatClipTime(3.25), "0:03.3");
	assertEquals(formatClipTime(75), "1:15.0");
	assertEquals(modelUnit("glb"), "m");
	assertEquals(modelUnit("stl"), null);
	assertEquals(itemLabel("  ", "Clip", 0), "Clip 1");
	assertEquals(itemLabel("Walk", "Clip", 3), "Walk");
});

Deno.test("modelFacts omits empty counts and keeps reading order", () => {
	const facts = modelFacts(
		"stl",
		{
			meshes: 1,
			vertices: 300,
			triangles: 100,
			materials: 1,
			textures: 0,
			animations: 0,
			cameras: 0,
			lights: 0,
		},
		[10, 20, 5],
		null,
	);
	assertEquals(facts.map((f) => f.label), [
		"Model format",
		"Meshes",
		"Triangles",
		"Vertices",
		"Materials",
		"Bounding size",
	]);
	assertEquals(facts[0].value, "STL");
	assertEquals(facts[5].value, "10 × 20 × 5 units");
});

Deno.test("resource names and OBJ material libraries", () => {
	assertEquals(resourceName("textures/Wood%20Oak.png?x=1"), "Wood Oak.png");
	assertEquals(resourceName("C:\\models\\scene.bin"), "scene.bin");
	assertEquals(
		objMaterialLibraries("# head\nmtllib a.mtl b.mtl\nv 0 0 0\n  mtllib a.mtl\n"),
		["a.mtl", "b.mtl"],
	);
	assertEquals(objMaterialLibraries("v 0 0 0"), []);
});

Deno.test("decodeDataUrl reads base64 and percent-encoded payloads", () => {
	const b64 = decodeDataUrl("data:application/octet-stream;base64,AAEC/w==");
	assertEquals(b64?.type, "application/octet-stream");
	assertEquals([...(b64?.bytes ?? [])], [0, 1, 2, 255]);
	const text = decodeDataUrl("data:,hi%20there");
	assertEquals(text?.type, "application/octet-stream");
	assertEquals(new TextDecoder().decode(text?.bytes), "hi there");
	assertEquals(decodeDataUrl("data:image/png;base64,@@@")?.bytes ?? null, null);
	assertEquals(decodeDataUrl("blob:x"), null);
	assertEquals(decodeDataUrl("data:nocomma"), null);
});

Deno.test("missing-resource wording", () => {
	assertEquals(missingNotice([]), null);
	const one = missingNotice(["a.png", "a.png"]);
	assert(one !== null && one.includes("1 separate file that isn't") && one.includes("a.png"));
	const many = missingNotice(["a", "b", "c", "d", "e"]);
	assert(many !== null && many.includes("a, b, c and 2 more"));
	assert(missingGeometryReason(["scene.bin"]).includes("scene.bin"));
});
