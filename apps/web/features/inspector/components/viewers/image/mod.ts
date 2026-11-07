import { h, type JSX } from "preact";
import type { ThreeRuntime } from "../../../core/three-loader.ts";
import { PanoramaCanvas } from "../panorama/PanoramaCanvas.tsx";
import { defineViewer, type ViewerProps, type ViewerShortcut } from "../viewer.ts";
import { createImageTools, type ImageTools } from "./image-tools.ts";
import { ImageStage } from "./ImageStage.tsx";
import { ImageControls } from "./ImageControls.tsx";
import { ImageChips } from "./ImageZoomBar.tsx";
import { copyImage } from "./copy-image.ts";

const IMAGE_SHORTCUTS: readonly ViewerShortcut[] = [
	{ keys: ["+"], label: "Zoom in" },
	{ keys: ["-"], label: "Zoom out" },
	{ keys: ["0"], label: "Fit to screen" },
	{ keys: ["1"], label: "Actual size (100%)" },
	{ keys: ["↑ ↓ ← →"], label: "Pan (Shift for larger steps)" },
	{ keys: ["R"], label: "Rotate right" },
	{ keys: ["Shift", "R"], label: "Rotate left" },
	{ keys: ["H"], label: "Flip horizontally" },
	{ keys: ["V"], label: "Flip vertically" },
	{ keys: ["G"], label: "Rule of thirds" },
];

async function loadPicture(rt: ThreeRuntime, src: string) {
	const texture = await new rt.THREE.TextureLoader().loadAsync(src);
	texture.colorSpace = rt.THREE.SRGBColorSpace;
	return texture;
}

/** The picture flat, or on a sphere when the reader asked for its 360° view. */
function ImageCanvas(props: ViewerProps<ImageTools>): JSX.Element {
	const { shell, tools } = props;
	if (!tools.panorama.value) return h(ImageStage, props);
	return h(PanoramaCanvas, {
		shell,
		view: tools.panoramaView,
		hdr: false,
		load: (rt) => loadPicture(rt, tools.source.peek()),
	});
}

/** The image and SVG canvas: zoom, pan, pinch, rotate, flip, a choice of background and a thirds guide. */
export const imageViewer = defineViewer<ImageTools>({
	createTools: createImageTools,
	Stage: ImageCanvas,
	Controls: ImageControls,
	Chips: (props) => (props.tools.panorama.value ? null : h(ImageChips, props)),
	shortcuts: IMAGE_SHORTCUTS,
	menu: ({ shell, tools, stage }) =>
		tools.panorama.peek() ? [] : [
			{
				key: "fit",
				label: "Zoom to fit",
				icon: "zoom-fit",
				shortcut: "0",
				command: () => tools.fitToStage(),
			},
			{
				key: "actual",
				label: "Actual size (100%)",
				icon: "zoom-in",
				shortcut: "1",
				command: () => tools.actualSize(),
			},
			{
				key: "copy-image",
				label: "Copy image",
				icon: "copy",
				command: () => void copyImage(stage, shell),
			},
		],
});

export { createImageTools, type ImageBackground, type ImageTools } from "./image-tools.ts";
