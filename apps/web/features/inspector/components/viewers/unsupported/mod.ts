import { h } from "preact";
import { defineViewer } from "../viewer.ts";
import { UnsupportedFallback } from "./UnsupportedFallback.tsx";

/** The fallback canvas: no preview, a download, and the stored preview image when there is one. */
export const unsupportedViewer = defineViewer<null>({
	createTools(shell) {
		if (shell.status.peek() === "loading") shell.status.value = "ready";
		return null;
	},
	Stage: ({ shell }) => h(UnsupportedFallback, { shell }),
	Controls: null,
	shortcuts: [],
});

export { UnsupportedFallback, type UnsupportedFallbackProps } from "./UnsupportedFallback.tsx";
