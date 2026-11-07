import { defineViewer, type ViewerShortcut } from "../viewer.ts";
import { CodeStage, CodeStageControls } from "./CodeStage.tsx";
import { MarkdownControls } from "./MarkdownControls.tsx";
import { MarkdownStage } from "./MarkdownStage.tsx";
import { TableControls } from "./TableControls.tsx";
import { TableStage, WorkbookStage } from "./TableStage.tsx";
import {
	type CodeTools,
	createCodeTools,
	createMarkdownTools,
	createTableTools,
	createWorkbookTools,
	type MarkdownTools,
	type TableTools,
} from "./text-tools.ts";

const CODE_SHORTCUTS: readonly ViewerShortcut[] = [
	{ keys: ["Ctrl", "F"], label: "Find in file" },
	{ keys: ["N"], label: "Next match" },
	{ keys: ["Shift", "N"], label: "Previous match" },
	{ keys: ["G"], label: "Go to line" },
	{ keys: ["W"], label: "Wrap long lines" },
	{ keys: ["+"], label: "Larger text" },
	{ keys: ["-"], label: "Smaller text" },
	{ keys: ["Esc"], label: "Clear the selected line" },
	{ keys: ["Ctrl", "A"], label: "Select all the text" },
];

/** Source code, coloured by highlight.js, in a line-numbered view. */
export const codeViewer = defineViewer<CodeTools>({
	createTools: (shell) => createCodeTools(shell, true),
	Stage: CodeStage,
	Controls: CodeStageControls,
	shortcuts: CODE_SHORTCUTS,
});

/** Plain text in the same line-numbered view, without colours. */
export const textViewer = defineViewer<CodeTools>({
	createTools: (shell) => createCodeTools(shell, false),
	Stage: CodeStage,
	Controls: CodeStageControls,
	shortcuts: CODE_SHORTCUTS,
});

/** Markdown rendered and sanitised, with a contents list and a source view. */
export const markdownViewer = defineViewer<MarkdownTools>({
	createTools: createMarkdownTools,
	Stage: MarkdownStage,
	Controls: MarkdownControls,
	shortcuts: [
		{ keys: ["S"], label: "Switch between rendered and source" },
		...CODE_SHORTCUTS.map((s) => ({ keys: s.keys, label: `${s.label} (source)` })),
	],
});

const SHEET_SHORTCUTS: readonly ViewerShortcut[] = [
	{ keys: ["Ctrl", "F"], label: "Filter rows" },
	{ keys: ["↑", "↓", "←", "→"], label: "Move between cells (when the grid has focus)" },
	{ keys: ["Shift", "↑", "↓", "←", "→"], label: "Extend the selection" },
	{ keys: ["Ctrl", "C"], label: "Copy the selected cells" },
];

/** CSV and TSV as a sortable, filterable grid. */
export const tableViewer = defineViewer<TableTools>({
	createTools: createTableTools,
	Stage: TableStage,
	Controls: TableControls,
	shortcuts: SHEET_SHORTCUTS,
});

/** A workbook in the same grid, with a tab for each sheet. */
export const sheetViewer = defineViewer<TableTools>({
	createTools: createWorkbookTools,
	Stage: WorkbookStage,
	Controls: TableControls,
	shortcuts: SHEET_SHORTCUTS,
});
