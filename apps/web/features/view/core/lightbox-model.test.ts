import { assertEquals } from "jsr:@std/assert@^1";
import {
	clampIndex,
	clickZoomTarget,
	largestCandidate,
	stepIndex,
	swipeStep,
	thumbOf,
} from "./lightbox-model.ts";

Deno.test("clampIndex — keeps the index inside the gallery", () => {
	assertEquals(clampIndex(-3, 4), 0);
	assertEquals(clampIndex(2.7, 4), 2);
	assertEquals(clampIndex(9, 4), 3);
	assertEquals(clampIndex(1, 0), 0);
	assertEquals(clampIndex(Number.NaN, 4), 0);
});

Deno.test("stepIndex — wraps at both ends", () => {
	assertEquals(stepIndex(0, -1, 4), 3);
	assertEquals(stepIndex(3, 1, 4), 0);
	assertEquals(stepIndex(1, 6, 4), 3);
	assertEquals(stepIndex(0, 1, 0), 0);
});

Deno.test("largestCandidate — picks the widest width-described candidate", () => {
	assertEquals(largestCandidate("a.jpg 480w, c.jpg 2400w, b.jpg 1280w"), "c.jpg");
	assertEquals(largestCandidate("only.jpg"), "only.jpg");
	assertEquals(largestCandidate(""), null);
	assertEquals(largestCandidate(undefined), null);
});

Deno.test("thumbOf — falls back from thumb to poster to src", () => {
	assertEquals(thumbOf({ src: "a", thumb: "t", alt: "" }), "t");
	assertEquals(thumbOf({ src: "a", poster: "p", alt: "" }), "p");
	assertEquals(thumbOf({ src: "a", alt: "" }), "a");
	assertEquals(thumbOf({ src: "a.mp4", alt: "", kind: "video" }), null);
});

Deno.test("clickZoomTarget — a shrunk picture reaches 100%, a fitted one enlarges past the stage", () => {
	assertEquals(clickZoomTarget(0.2), 1);
	assertEquals(clickZoomTarget(1), 2.5);
	assertEquals(clickZoomTarget(0), 2.5);
});

Deno.test("swipeStep — pages only on a long, mostly horizontal drag", () => {
	assertEquals(swipeStep(-200, 10, 1000), 1);
	assertEquals(swipeStep(200, 10, 1000), -1);
	assertEquals(swipeStep(-100, 10, 1000), 0);
	assertEquals(swipeStep(-200, 300, 1000), 0);
	assertEquals(swipeStep(-200, 10, 1000, true), -1);
	assertEquals(swipeStep(-200, 10, 0), 0);
});
