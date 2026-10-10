import { defineViewer, type ViewerShortcut } from "../viewer.ts";
import { createImageTools, type ImageTools } from "./image-tools.ts";
import { ImageStage } from "./ImageStage.tsx";
import { ImageControls } from "./ImageControls.tsx";
import { ImageChips } from "./ImageZoomBar.tsx";

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

/** The image and SVG canvas: zoom, pan, pinch, rotate, flip, a choice of background and a thirds guide. */
export const imageViewer = defineViewer<ImageTools>({
	createTools: createImageTools,
	Stage: ImageStage,
	Controls: ImageControls,
	Chips: ImageChips,
	shortcuts: IMAGE_SHORTCUTS,
});

export { createImageTools, type ImageBackground, type ImageTools } from "./image-tools.ts";
