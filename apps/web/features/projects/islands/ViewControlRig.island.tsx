import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/view-control-rig.css";
import { ZoomSlider } from "@projective/ui/fields";
import {
	restoreZoom,
	setZoom,
	viewMode,
	zoom,
	ZOOM_CENTER,
	ZOOM_MAX,
	ZOOM_MIN,
	ZOOM_SEGMENTS,
	ZOOM_STEP,
} from "../core/view-state.ts";
import { GridIcon, ListIcon } from "../components/file-glyphs.tsx";

/**
 * ViewControlRig — the File Explorer's view-control rig, mounted in the middle-nav FOOTER band (left-
 * aligned, `sticky; bottom: 0`) via {@link filesFooterFor}. It is the minus button · a thin segmented
 * zoom track with a centred transition marker · the plus button (the reusable {@link ZoomSlider}),
 * preceded by a NON-interactive current-view glyph (list/grid) — deliberately NOT a toggle (crossing
 * the centre marker transitions the view). It writes the shared {@link zoom} signal, so the explorer
 * body (a separate island) reactively swaps its presentation. Dumb island: no data access.
 */
export default function ViewControlRig(): JSX.Element {
	useEffect(() => restoreZoom(), []);

	return (
		<div class="fx-rig">
			<span class="fx-rig__mode" data-mode={viewMode.value} aria-hidden="true">
				{viewMode.value === "grid" ? <GridIcon size={16} /> : <ListIcon size={16} />}
			</span>
			<ZoomSlider
				value={zoom}
				onValueChange={setZoom}
				min={ZOOM_MIN}
				max={ZOOM_MAX}
				step={ZOOM_STEP}
				segments={ZOOM_SEGMENTS}
				center={ZOOM_CENTER}
				size="sm"
				aria-label="File view zoom"
			/>
		</div>
	);
}
