import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/catalogue.css";
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
import { GridIcon, ListIcon } from "../components/catalogue-glyphs.tsx";

/**
 * CatalogueViewControlRig — the console's view-control rig, mounted in the middle-nav FOOTER band via
 * {@link catalogueFooterFor}. It is the minus button · a segmented zoom track with a centred transition
 * marker · the plus button (the reusable {@link ZoomSlider}), preceded by a NON-interactive current-view
 * glyph (list/grid) — deliberately NOT a toggle (crossing the centre marker transitions the view). It
 * writes the shared {@link zoom} signal, so the console body (a separate island) reactively swaps its
 * presentation. Dumb island: no data access. (Cloned from the File Explorer rig, Decision #32.)
 */
export default function CatalogueViewControlRig(): JSX.Element {
	useEffect(() => restoreZoom(), []);

	return (
		<div class="cat-rig">
			<span class="cat-rig__mode" data-mode={viewMode.value} aria-hidden="true">
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
				aria-label="Catalogue view zoom"
			/>
		</div>
	);
}
