import { assertEquals } from "@std/assert";
import { looksEquirectangular, opensAsPanorama } from "./image-tools.ts";

Deno.test("only a large 2:1 picture has the shape of an unrolled sphere", () => {
	assertEquals(looksEquirectangular(4096, 2048), true);
	assertEquals(looksEquirectangular(4096, 2040), true);
	assertEquals(looksEquirectangular(1920, 1080), false);
	assertEquals(looksEquirectangular(800, 400), false);
});

Deno.test("a 2:1 banner stays flat until its name says otherwise", () => {
	const shape = { width: 4096, height: 2048 };
	assertEquals(opensAsPanorama({ name: "hero-banner.jpg", ...shape }), false);
	assertEquals(opensAsPanorama({ name: "lobby_360.jpg", ...shape }), true);
	assertEquals(opensAsPanorama({ name: "Beach panorama.png", ...shape }), true);
});

Deno.test("a panorama's name alone proves nothing without its shape", () => {
	assertEquals(opensAsPanorama({ name: "pano.jpg", width: 1600, height: 900 }), false);
	assertEquals(opensAsPanorama({ name: "pano.jpg", width: null, height: null }), false);
});
