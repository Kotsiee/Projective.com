import {
	type DecodedTexture,
	decodeTexture,
	type TextureFormat,
	type TexturePreview,
	toneMappedPreview,
} from "./texture-read.ts";

/**
 * texture-worker — decodes one HDR or EXR file off the main thread and ends. In `core/`, not
 * `islands/`, for the reason `files/core/hash-worker.ts` gives.
 */

/** The one message posted in. `previewWidth` asks for screen-ready bytes instead of full pixels. */
export interface TextureRequest {
	bytes: ArrayBuffer;
	format: TextureFormat;
	maxWidth: number;
	previewWidth?: number;
}

/** The one message posted back. */
export type TextureResponse =
	| { kind: "texture"; texture: DecodedTexture }
	| { kind: "preview"; preview: TexturePreview }
	| { kind: "failed" };

interface WorkerScope {
	addEventListener(type: "message", listener: (event: MessageEvent<TextureRequest>) => void): void;
	postMessage(message: TextureResponse, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.addEventListener("message", ({ data }) => {
	try {
		const texture = decodeTexture(data.bytes, data.format, data.maxWidth);
		if (data.previewWidth === undefined) {
			scope.postMessage({ kind: "texture", texture }, [texture.pixels.buffer]);
			return;
		}
		const preview = toneMappedPreview(texture, data.previewWidth);
		scope.postMessage({ kind: "preview", preview }, [preview.pixels.buffer]);
	} catch {
		scope.postMessage({ kind: "failed" });
	}
});
