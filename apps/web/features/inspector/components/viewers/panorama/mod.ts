import { h } from "preact";
import { INSPECT_TEXTURE_BYTES } from "@projective/types/files";
import type { TextureFormat } from "../../../core/texture-read.ts";
import { decodeTextureFile } from "../../../core/texture-client.ts";
import type { ThreeRuntime } from "../../../core/three-loader.ts";
import { defineViewer } from "../viewer.ts";
import { PanoramaCanvas, PanoramaTools } from "./PanoramaCanvas.tsx";
import { createPanoramaView, type PanoramaView } from "./panorama-engine.ts";

function loadHdrTexture(src: string, format: TextureFormat) {
	return async (rt: ThreeRuntime, maxTextureSize: number, signal: AbortSignal) => {
		const res = await fetch(src, { signal, credentials: "same-origin" });
		if (!res.ok) throw new Error("The file couldn't be loaded.");
		const decoded = await decodeTextureFile(await res.arrayBuffer(), format, maxTextureSize);
		const { THREE: T } = rt;
		const texture = new T.DataTexture(
			decoded.pixels,
			decoded.width,
			decoded.height,
			T.RGBAFormat,
			T.HalfFloatType,
		);
		texture.flipY = true;
		texture.minFilter = T.LinearFilter;
		texture.magFilter = T.LinearFilter;
		texture.wrapS = T.RepeatWrapping;
		texture.generateMipmaps = false;
		texture.needsUpdate = true;
		return texture;
	};
}

/** HDR and EXR files: tone-mapped on a sphere, to look around from inside. */
export const panoramaViewer = defineViewer<PanoramaView>({
	createTools(shell) {
		if (shell.asset.sizeBytes > INSPECT_TEXTURE_BYTES && shell.status.peek() !== "error") {
			shell.fail("This texture is too large to preview. Download it to open it on your device.");
		}
		return createPanoramaView();
	},
	Stage: ({ shell, tools }) =>
		h(PanoramaCanvas, {
			shell,
			view: tools,
			hdr: true,
			load: loadHdrTexture(
				shell.asset.src,
				shell.asset.ext.toLowerCase() === "exr" ? "exr" : "hdr",
			),
		}),
	Controls: ({ tools }) => h(PanoramaTools, { view: tools, hdr: true }),
	shortcuts: [
		{ keys: ["↑ ↓ ← →"], label: "Look around" },
		{ keys: ["+"], label: "Zoom in" },
		{ keys: ["-"], label: "Zoom out" },
		{ keys: ["0"], label: "Reset the view" },
	],
});
