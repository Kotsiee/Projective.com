import { defineViewer } from "../viewer.ts";
import { type ArchiveTools, createArchiveTools } from "./archive-tools.ts";
import { ArchiveStage } from "./ArchiveStage.tsx";

/** ZIP and tar archives: a browsable tree of what is inside, with nothing unpacked. */
export const archiveViewer = defineViewer<ArchiveTools>({
	createTools: createArchiveTools,
	Stage: ArchiveStage,
	Controls: null,
	shortcuts: [
		{ keys: ["↑", "↓"], label: "Move through the list" },
		{ keys: ["→"], label: "Open a folder" },
		{ keys: ["←"], label: "Close a folder, or go to its parent" },
		{ keys: ["Enter"], label: "Open or close a folder" },
	],
});
