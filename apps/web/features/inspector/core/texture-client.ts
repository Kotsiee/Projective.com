/// <reference lib="dom" />
import type { DecodedTexture, TextureFormat, TexturePreview } from "./texture-read.ts";
import type { TextureRequest, TextureResponse } from "./texture-worker.ts";

/**
 * texture-client — the page's side of `texture-worker.ts`. Types only cross this import, so three's
 * loaders enter no page bundle; a worker starts for one decode and ends with it.
 */

function decode(request: TextureRequest): Promise<TextureResponse> {
	return new Promise((resolve) => {
		const worker = new Worker(new URL("./texture-worker.ts", import.meta.url), { type: "module" });
		const finish = (response: TextureResponse) => {
			worker.terminate();
			resolve(response);
		};
		worker.addEventListener(
			"message",
			(event: MessageEvent<TextureResponse>) => finish(event.data),
		);
		worker.addEventListener("error", () => finish({ kind: "failed" }));
		worker.postMessage(request, [request.bytes]);
	});
}

/** Full pixels for the panorama canvas. Rejects when the file cannot be decoded. */
export async function decodeTextureFile(
	bytes: ArrayBuffer,
	format: TextureFormat,
	maxWidth: number,
): Promise<DecodedTexture> {
	const response = await decode({ bytes, format, maxWidth });
	if (response.kind !== "texture") throw new Error("The texture couldn't be decoded.");
	return response.texture;
}

/** A small, screen-ready copy for a card. Rejects when the file cannot be decoded. */
export async function previewTextureFile(
	bytes: ArrayBuffer,
	format: TextureFormat,
	width: number,
): Promise<TexturePreview> {
	const response = await decode({ bytes, format, maxWidth: Infinity, previewWidth: width });
	if (response.kind !== "preview") throw new Error("The texture couldn't be decoded.");
	return response.preview;
}
