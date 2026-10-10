import type { JSX } from "preact";
import { PDF_ZOOM_MAX, PDF_ZOOM_MIN, zoomPercent } from "../../../core/pdf-zoom.ts";
import { ToolButton, ToolReadout } from "../../controls/mod.ts";
import type { ViewerProps } from "../viewer.ts";
import type { PdfTools } from "./pdf-tools.ts";

/** The PDF canvas's compact on-canvas chips for an embedding host: page n / N and zoom. */
export function PdfChips({ tools }: ViewerProps<PdfTools>): JSX.Element | null {
	const engine = tools.engine.value;
	if (!engine) return null;
	const page = tools.page.value;
	const count = tools.pageCount.value;
	const zoom = tools.zoom.value;
	return (
		<div class="ins-chips" role="toolbar" aria-label="Pages and zoom">
			<ToolButton
				icon="chevron-up"
				label="Previous page"
				shortcut="PageUp"
				disabled={page <= 1}
				onClick={() => engine.stepPage(-1)}
			/>
			<span class="ins-chips__readout">
				<ToolReadout value={`${page} / ${count}`} label="Page" />
			</span>
			<ToolButton
				icon="chevron-down"
				label="Next page"
				shortcut="PageDown"
				disabled={page >= count}
				onClick={() => engine.stepPage(1)}
			/>
			<span class="ins-chips__sep" aria-hidden="true" />
			<ToolButton
				icon="zoom-out"
				label="Zoom out"
				shortcut="-"
				disabled={zoom <= PDF_ZOOM_MIN}
				onClick={() => engine.stepZoom(-1)}
			/>
			<span class="ins-chips__readout">
				<ToolReadout value={zoomPercent(zoom)} label="Zoom" />
			</span>
			<ToolButton
				icon="zoom-in"
				label="Zoom in"
				shortcut="+"
				disabled={zoom >= PDF_ZOOM_MAX}
				onClick={() => engine.stepZoom(1)}
			/>
		</div>
	);
}
