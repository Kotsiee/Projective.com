import { defineViewer, printGated, type ViewerShortcut } from "../viewer.ts";
import { createDocxTools, type DocxTools } from "./docx-tools.ts";
import { DocxStage } from "./DocxStage.tsx";
import { DocxControls } from "./DocxControls.tsx";
import { createFontTools, type FontTools } from "./font-tools.ts";
import { FontStage } from "./FontStage.tsx";
import { FontControls } from "./FontControls.tsx";

const DOCX_SHORTCUTS: readonly ViewerShortcut[] = [
	{ keys: ["+"], label: "Zoom in" },
	{ keys: ["-"], label: "Zoom out" },
	{ keys: ["0"], label: "Fit to width" },
	{ keys: ["1"], label: "Actual size" },
	{ keys: ["Ctrl", "Wheel"], label: "Zoom" },
	{ keys: ["Ctrl", "P"], label: "Print" },
];

/** The Word canvas: paged .docx rendering with zoom, optional layers and print. */
export const docxViewer = defineViewer<DocxTools>({
	createTools: createDocxTools,
	Stage: DocxStage,
	Controls: DocxControls,
	shortcuts: (shell) => printGated(shell, DOCX_SHORTCUTS),
});

/** The font canvas: an editable specimen, size waterfall and Latin glyph grid. */
export const fontViewer = defineViewer<FontTools>({
	createTools: createFontTools,
	Stage: FontStage,
	Controls: FontControls,
	shortcuts: [
		{ keys: ["+"], label: "Larger sample" },
		{ keys: ["-"], label: "Smaller sample" },
	],
});
