import { defineViewer, printGated, type ViewerShortcut } from "../viewer.ts";
import { PdfChips } from "./PdfChips.tsx";
import { PdfControls } from "./PdfControls.tsx";
import { PdfStage } from "./PdfStage.tsx";
import { createPdfTools, type PdfTools } from "./pdf-tools.ts";

/** Keys the PDF canvas honours while the stage has focus (find and print work anywhere). */
export const PDF_SHORTCUTS: readonly ViewerShortcut[] = [
	{ keys: ["PageDown"], label: "Next page" },
	{ keys: ["PageUp"], label: "Previous page" },
	{ keys: ["Home"], label: "First page" },
	{ keys: ["End"], label: "Last page" },
	{ keys: ["+"], label: "Zoom in" },
	{ keys: ["-"], label: "Zoom out" },
	{ keys: ["0"], label: "Fit to width" },
	{ keys: ["Ctrl", "Wheel"], label: "Zoom at the pointer" },
	{ keys: ["R"], label: "Rotate clockwise" },
	{ keys: ["Shift", "R"], label: "Rotate counter-clockwise" },
	{ keys: ["Ctrl", "F"], label: "Find in document" },
	{ keys: ["Enter"], label: "Next match (in find)" },
	{ keys: ["Ctrl", "P"], label: "Print" },
];

/** The PDF canvas: pdf.js pages with text selection, thumbnails, find, outline and print. */
export const pdfViewer = defineViewer<PdfTools>({
	createTools: () => createPdfTools(),
	Stage: PdfStage,
	Controls: PdfControls,
	Chips: PdfChips,
	shortcuts: (shell) => printGated(shell, PDF_SHORTCUTS),
});
