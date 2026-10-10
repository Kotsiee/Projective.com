import { defineViewer } from "../viewer.ts";
import { createModelTools, type ModelTools } from "./model-tools.ts";
import { ModelStage } from "./ModelStage.tsx";
import { ModelControls } from "./ModelControls.tsx";

/**
 * The 3D canvas (glb, gltf, obj, stl, ply, fbx, 3mf, dae, usdz): orbit/pan/zoom navigation, named
 * views, perspective or orthographic projection, studio and file lights, environment reflections,
 * display modes, helpers and animation playback.
 */
export const modelViewer = defineViewer<ModelTools>({
	createTools: createModelTools,
	Stage: ModelStage,
	Controls: ModelControls,
	shortcuts: [
		{ keys: ["1–7"], label: "Front, back, left, right, top, bottom, iso view" },
		{ keys: ["0"], label: "Frame the model" },
		{ keys: ["R"], label: "Reset the view" },
		{ keys: ["Arrows"], label: "Orbit" },
		{ keys: ["Shift", "Arrows"], label: "Pan" },
		{ keys: ["+"], label: "Zoom in" },
		{ keys: ["-"], label: "Zoom out" },
		{ keys: ["O"], label: "Perspective or orthographic" },
		{ keys: ["W"], label: "Wireframe" },
		{ keys: ["G"], label: "Grid floor" },
		{ keys: ["Space"], label: "Play or pause the animation" },
	],
});

export { createModelTools, FREE_ORBIT, type ModelTools } from "./model-tools.ts";
