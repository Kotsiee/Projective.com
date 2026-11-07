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
import { sheetViewer } from "./text/mod.ts";
import { presentationViewer } from "./presentation/mod.ts";
import { panoramaViewer } from "./panorama/mod.ts";
import { archiveViewer } from "./archive/mod.ts";
import { unsupportedViewer } from "./unsupported/mod.ts";
import { pageAllowsEngines } from "../../core/page-engines.ts";

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
	sheet: sheetViewer,
	presentation: presentationViewer,
	panorama: panoramaViewer,
	archive: archiveViewer,
	unsupported: unsupportedViewer,
};

/** Canvases a host swaps in where its page's CSP keeps the model decoders out. */
const EMBEDDED_VIEWERS: Readonly<
	Partial<Record<InspectViewer, (shell: InspectorShell) => MountedViewer>>
> = {
	model: embedModelHandoff,
};

/** Mount the canvas for the shell's asset, honouring the shell's embedding options. */
export function mountViewer(shell: InspectorShell): MountedViewer {
	const kind = shell.asset.viewer;
	const swap = shell.options.embedded && !pageAllowsEngines() ? EMBEDDED_VIEWERS[kind] : undefined;
	const mount = swap ?? VIEWERS[kind];
	return mount(shell);
}
