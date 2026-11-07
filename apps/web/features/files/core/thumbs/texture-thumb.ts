/// <reference lib="dom" />
import { previewTextureFile } from "@features/inspector/core/texture-client.ts";
import type { ThumbOutput } from "./thumb-cache.ts";
import type { ThumbJob } from "./thumb-plan.ts";
import { canvasBlob, THUMB_PX } from "./thumb-canvas.ts";

/** An HDR or EXR file as a flat, tone-mapped picture; the decode runs in the texture worker. */
export async function renderTexture(
	job: ThumbJob,
	signal: AbortSignal,
): Promise<ThumbOutput | null> {
	const res = await fetch(job.src, { credentials: "same-origin", signal });
	if (!res.ok) {
		await res.body?.cancel();
		return null;
	}
	const format = job.ext === "exr" ? "exr" : "hdr";
	const preview = await previewTextureFile(await res.arrayBuffer(), format, THUMB_PX);
	const canvas = document.createElement("canvas");
	canvas.width = preview.width;
	canvas.height = preview.height;
	const pixels = new ImageData(
		preview.pixels as Uint8ClampedArray<ArrayBuffer>,
		preview.width,
		preview.height,
	);
	canvas.getContext("2d")?.putImageData(pixels, 0, 0);
	const blob = await canvasBlob(canvas);
	return blob ? { blob } : null;
}
