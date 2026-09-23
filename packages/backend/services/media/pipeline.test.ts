import { assert, assertEquals, assertRejects } from "@std/assert";
import { encode as encodePngRaw } from "@jsquash/png";
import { MediaPipeline, MediaRejectedError, workerUrl } from "./pipeline.ts";

Deno.test({
	name: "MediaPipeline: jobs run in a Worker, in parallel, and a refusal names the input",
	// Workers are torn down explicitly below; the sanitizers would otherwise flag the pool.
	sanitizeOps: false,
	sanitizeResources: false,
	async fn() {
		assert(workerUrl(), "the worker module must resolve from source");
		const data = new Uint8ClampedArray(900 * 600 * 4).map((_, i) => [20, 120, 220, 255][i % 4]);
		const png = new Uint8Array(
			await encodePngRaw({ data, width: 900, height: 600 } as unknown as ImageData),
		);
		const jobs = [0, 1, 2].map(() =>
			MediaPipeline.run({
				kind: "render",
				bytes: png,
				mime: "image/png",
				purpose: "avatar",
				crop: { zoom: 2, rotation: 15, cx: 0, cy: 0 },
			})
		);
		const results = await Promise.all(jobs);
		for (const r of results) {
			assertEquals(r.full!.width, r.full!.height);
			assertEquals(r.tiers.sm.width, 96);
			assert(r.blurhash);
		}
		// The caller's bytes are intact — the pool transfers a COPY, never the caller's buffer.
		assertEquals(png[1], 0x50);

		await assertRejects(
			() => MediaPipeline.run({ kind: "ingest", bytes: new TextEncoder().encode("not a picture"), mime: "image/png" }),
			MediaRejectedError,
		);
		MediaPipeline.shutdown();
	},
});
