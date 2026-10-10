import type { JSX } from "preact";
import { PDF_ZOOM_MAX, PDF_ZOOM_MIN, zoomPercent } from "../../../core/pdf-zoom.ts";
import { ToolButton, ToolReadout } from "../../controls/mod.ts";
import type { PdfEngine } from "./pdf-engine.ts";
import type { PdfTools } from "./pdf-tools.ts";

/** Props for {@link PdfStageBar}. */
export interface PdfStageBarProps {
	tools: PdfTools;
	engine: PdfEngine;
}

/** Open the find bar and ask it to take focus. */
export function openFind(tools: PdfTools): void {
	tools.find.open.value = true;
	tools.find.focusRequest.value = tools.find.focusRequest.peek() + 1;
}

/** The small floating bar over the pages: thumbnails, page n / N, zoom and find. */
export function PdfStageBar({ tools, engine }: PdfStageBarProps): JSX.Element {
	const page = tools.page.value;
	const count = tools.pageCount.value;
	const zoom = tools.zoom.value;
	const thumbnails = tools.thumbnails.value;
	const finding = tools.find.open.value;
	return (
		<div class="ins-pdf-bar" role="group" aria-label="Pages and zoom">
			<ToolButton
				icon="page-thumbnails"
				label={thumbnails ? "Hide thumbnails" : "Show thumbnails"}
				pressed={thumbnails}
				onClick={() => (tools.thumbnails.value = !thumbnails)}
			/>
			<span class="ins-pdf-bar__sep" aria-hidden="true" />
			<ToolButton
				icon="chevron-up"
				label="Previous page"
				shortcut="PageUp"
				disabled={page <= 1}
				onClick={() => engine.stepPage(-1)}
			/>
			<ToolReadout value={`${page} / ${count}`} label="Page" />
			<ToolButton
				icon="chevron-down"
				label="Next page"
				shortcut="PageDown"
				disabled={page >= count}
				onClick={() => engine.stepPage(1)}
			/>
			<span class="ins-pdf-bar__sep" aria-hidden="true" />
			<ToolButton
				icon="zoom-out"
				label="Zoom out"
				shortcut="-"
				disabled={zoom <= PDF_ZOOM_MIN}
				onClick={() => engine.stepZoom(-1)}
			/>
			<ToolReadout value={zoomPercent(zoom)} label="Zoom" />
			<ToolButton
				icon="zoom-in"
				label="Zoom in"
				shortcut="+"
				disabled={zoom >= PDF_ZOOM_MAX}
				onClick={() => engine.stepZoom(1)}
			/>
			<span class="ins-pdf-bar__sep" aria-hidden="true" />
			<ToolButton
				icon="search"
				label="Find in document"
				shortcut="Ctrl+F"
				pressed={finding}
				onClick={() => (finding ? (tools.find.open.value = false) : openFind(tools))}
			/>
		</div>
	);
}
