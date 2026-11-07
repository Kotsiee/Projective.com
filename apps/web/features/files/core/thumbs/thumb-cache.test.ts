import { assertEquals } from "@std/assert";
import { markThumbEmpty, peekThumb, purgeThumbs, readThumb, saveThumb } from "./thumb-cache.ts";

const SETTLE = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

Deno.test({
	name: "a saved thumbnail reads back at once, and from storage on the next visit",
	sanitizeResources: false,
	sanitizeOps: false,
	async fn() {
		await purgeThumbs();
		const result = saveThumb("a", { lines: ["const x = 1;"] });
		assertEquals(result, { type: "lines", lines: ["const x = 1;"] });
		assertEquals(peekThumb("a"), result);
		await SETTLE();
		await purgeThumbs();
	},
});

Deno.test({
	name: "sign-out leaves nothing to read back, in memory or in storage",
	sanitizeResources: false,
	sanitizeOps: false,
	async fn() {
		saveThumb("private-file", { blob: new Blob(["pixels"], { type: "image/webp" }) });
		assertEquals(peekThumb("private-file")?.type, "image");
		await SETTLE();
		await purgeThumbs();
		assertEquals(peekThumb("private-file"), null);
		assertEquals(await readThumb("private-file"), null);
	},
});

Deno.test("a file with nothing to draw is remembered for this page only", async () => {
	assertEquals(markThumbEmpty("broken"), { type: "none" });
	assertEquals(peekThumb("broken"), { type: "none" });
	await purgeThumbs();
	assertEquals(await readThumb("broken"), null);
});
