import { defineViewer } from "../viewer.ts";
import { PresentationChips, PresentationStage } from "./PresentationStage.tsx";
import { createPresentationTools, type PresentationTools } from "./presentation-tools.ts";

/** PowerPoint decks: one slide at a time, drawn to a canvas from the file's own parts. */
export const presentationViewer = defineViewer<PresentationTools>({
	createTools: createPresentationTools,
	Stage: PresentationStage,
	Controls: null,
	Chips: PresentationChips,
	shortcuts: [
		{ keys: ["→"], label: "Next slide" },
		{ keys: ["←"], label: "Previous slide" },
		{ keys: ["Home"], label: "First slide" },
		{ keys: ["End"], label: "Last slide" },
	],
});
