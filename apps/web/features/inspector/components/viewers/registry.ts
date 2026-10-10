import type { InspectViewer } from "@projective/types/files";
import type { InspectorShell } from "../../core/inspector-shell.ts";
import type { MountedViewer } from "./viewer.ts";
import { imageViewer } from "./image/mod.ts";
import { audioViewer, videoViewer } from "./media/mod.ts";
import { codeViewer, markdownViewer, tableViewer, textViewer } from "./text/mod.ts";
import { pdfViewer } from "./pdf/mod.ts";
import { modelViewer } from "./model/mod.ts";
import { embedModelHandoff } from "./model/ModelHandoff.tsx";
import { docxViewer, fontViewer } from "./document/mod.ts";
import { unsupportedViewer } from "./unsupported/mod.ts";

/** The canvas for every {@link InspectViewer}, chosen server-side by `resolveViewer`. */
export const VIEWERS: Readonly<Record<InspectViewer, (shell: InspectorShell) => MountedViewer>> = {
	image: imageViewer,
	svg: imageViewer,
	video: videoViewer,
	audio: audioViewer,
	pdf: pdfViewer,
	markdown: markdownViewer,
	code: codeViewer,
	text: textViewer,
	table: tableViewer,
	model: modelViewer,
	docx: docxViewer,
	font: fontViewer,
	unsupported: unsupportedViewer,
};

/** Canvases an embedding host swaps in: the app CSP keeps the WebGL decoders on `/inspect` only. */
const EMBEDDED_VIEWERS: Readonly<
	Partial<Record<InspectViewer, (shell: InspectorShell) => MountedViewer>>
> = {
	model: embedModelHandoff,
};

/** Mount the canvas for the shell's asset, honouring the shell's embedding options. */
export function mountViewer(shell: InspectorShell): MountedViewer {
	const kind = shell.asset.viewer;
	const mount = (shell.options.embedded ? EMBEDDED_VIEWERS[kind] : undefined) ?? VIEWERS[kind];
	return mount(shell);
}
