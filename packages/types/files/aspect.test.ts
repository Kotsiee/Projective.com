import { assertEquals } from "@std/assert";
import {
	aspectRatioOf,
	clampShowcaseAspect,
	mediaDimensionsOf,
	SHOWCASE_ASPECT_DEFAULT,
	SHOWCASE_ASPECT_MAX,
	SHOWCASE_ASPECT_MIN,
	showcaseAspectNote,
	showcaseAspectOf,
	withinShowcaseBounds,
} from "./aspect.ts";
import type { AssetMetadata } from "./metadata.ts";

/**
 * The showcase band, pinned.
 *
 * Every product tile on three surfaces sizes itself from these functions, so a drift here is a column
 * that no longer interlocks rather than a failing type. The bounds are asserted against literal
 * fractions, because a rounded float in a test is exactly the drift it is meant to catch.
 */

const envelope = (media: AssetMetadata["media"]): AssetMetadata => ({
	version: 1,
	source: "client",
	extractedAt: "2026-09-18T09:00:00.000Z",
	media,
	notes: [],
});

Deno.test("the band is 4:5 to 16:9, inclusive", () => {
	assertEquals(SHOWCASE_ASPECT_MIN, 4 / 5);
	assertEquals(SHOWCASE_ASPECT_MAX, 16 / 9);
	assertEquals(withinShowcaseBounds(4 / 5), true);
	assertEquals(withinShowcaseBounds(16 / 9), true);
	assertEquals(withinShowcaseBounds(1), true);
	assertEquals(withinShowcaseBounds(0.5), false);
	assertEquals(withinShowcaseBounds(2.35), false);
	assertEquals(withinShowcaseBounds(Number.NaN), false);
});

Deno.test("a ratio inside the band governs the tile whole", () => {
	const fit = showcaseAspectOf({ width: 800, height: 600, aspectRatio: 1.3333 });
	assertEquals(fit.ratio, 1.3333);
	assertEquals(fit.natural, 1.3333);
	assertEquals(fit.fit, "natural");
});

Deno.test("a ratio outside the band is clamped to the nearer bound and reported as a crop", () => {
	const tower = showcaseAspectOf(0.5);
	assertEquals(tower.ratio, SHOWCASE_ASPECT_MIN);
	assertEquals(tower.natural, 0.5);
	assertEquals(tower.fit, "cover");

	const strip = showcaseAspectOf({ width: 2350, height: 1000, aspectRatio: 2.35 });
	assertEquals(strip.ratio, SHOWCASE_ASPECT_MAX);
	assertEquals(strip.fit, "cover");
});

Deno.test("nothing known takes the default and is not called a crop", () => {
	for (const source of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
		const fit = showcaseAspectOf(source);
		assertEquals(fit.ratio, SHOWCASE_ASPECT_DEFAULT, `source ${source}`);
		assertEquals(fit.fit, "natural", `source ${source}`);
	}
	assertEquals(clampShowcaseAspect(Number.NaN), SHOWCASE_ASPECT_DEFAULT);
});

Deno.test("aspectRatioOf rounds to the 4dp the extractor stores", () => {
	assertEquals(aspectRatioOf(800, 600), 1.3333);
	assertEquals(aspectRatioOf(1920, 1080), 1.7778);
	assertEquals(aspectRatioOf(0, 600), SHOWCASE_ASPECT_DEFAULT);
});

Deno.test("mediaDimensionsOf reads images and video frames, and nothing else", () => {
	const image = envelope({
		kind: "image",
		width: 1200,
		height: 1500,
		aspectRatio: 0.8,
		blurhash: null,
		colors: null,
		animated: false,
		vector: false,
		hasAlpha: null,
	});
	assertEquals(mediaDimensionsOf(image), { width: 1200, height: 1500, aspectRatio: 0.8 });

	const audio = envelope({
		kind: "audio",
		durationMs: 1000,
		durationLabel: "0:01",
		peaks: [],
		sampleRate: null,
		channels: null,
	});
	assertEquals(mediaDimensionsOf(audio), undefined);
	assertEquals(mediaDimensionsOf(envelope({ kind: "generic" })), undefined);
	assertEquals(mediaDimensionsOf(null), undefined);
});

Deno.test("the note is raised only outside the band and names the side that overflowed", () => {
	assertEquals(showcaseAspectNote({ width: 800, height: 800, aspectRatio: 1 }), null);
	assertEquals(showcaseAspectNote(undefined), null);
	const tall = showcaseAspectNote({ width: 500, height: 1000, aspectRatio: 0.5 });
	const wide = showcaseAspectNote({ width: 2350, height: 1000, aspectRatio: 2.35 });
	assertEquals(tall?.includes("taller"), true);
	assertEquals(wide?.includes("wider"), true);
	assertEquals((tall?.length ?? 0) <= 200, true);
	assertEquals((wide?.length ?? 0) <= 200, true);
});
